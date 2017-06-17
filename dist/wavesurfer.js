/*! wavesurfer.js 1.4.0A (Mon, 6 Jun 2017)
* https://github.com/katspaugh/wavesurfer.js
* @license BSD-3-Clause
*/

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    // AMD. Register as an anonymous module unless amdModuleId is set
    define('wavesurfer', [], function () {
      return (root['WaveSurfer'] = factory());
    });
  } else if (typeof exports === 'object') {
    // Node. Does not work with strict CommonJS, but
    // only CommonJS-like environments that support module.exports,
    // like Node.
    module.exports = factory();
  } else {
    root['WaveSurfer'] = factory();
  }
}(this, function () {

'use strict';

var WaveSurfer = {
    defaultParams: {
        audioContext  : null,
        audioRate     : 1,
        autoCenter    : true,
        backend       : 'WebAudio',
        barHeight     : 1,
        classList     : {},
        styleList     : {cursor: {}},
        closeAudioContext: false,
        container     : null,
        cursorAlignment: 'middle',
        cursorColor   : '#333',
        cursorWidth   : 1,
        dragSelection : true,
        fillColor     : undefined,
        fillParent    : true,
        forceDecode   : false,
        height        : 128,
        hideScrollbar : false,
        interact      : true,
        invertTransparency: false,
        loopSelection : true,
        mediaContainer: null,
        mediaControls : false,
        mediaType     : 'audio',
        minPxPerSec   : 20,
        partialRender : false,
        pixelRatio    : window.devicePixelRatio || screen.deviceXDPI / screen.logicalXDPI,
        progressColor : '#555',
        normalize     : false,
        renderer      : 'MultiCanvas',
        scrollParent  : false,
        skipLength    : 2,
        splitChannels : false,
        waveColor     : '#999',
    },

    init: function (params) {
        var my = this;

        // Get defaults.
        var temp = Object.assign ({}, this.defaultParams);

        // Set aliases.
        this.aliases = {};
        this.aliases.cursorColor = {
            target: {object: temp.styleList.cursor, property: '_backgroundColor'},
            sourceList: [
                {object: temp, property: 'cursorColor'},
                {object: temp.styleList.cursor, property: 'backgroundColor'}
            ]
        };
        this.aliases.cursorWidth = {
            target: {object: temp.styleList.cursor, property: '_width'},
            sourceList: [
                {object: temp, property: 'cursorWidth', get: function (n) { return parseFloat(n); }, set: function (n) { return n + 'px'; }},
                {object: temp.styleList.cursor, property: 'width'}
            ]
        };
        WaveSurfer.util.refreshAliases (this.aliases);

        // Merge defaults and init parameters.
        this.params = WaveSurfer.util.deepMerge(temp, params);

        this.container = (typeof params.container == 'string') ?
            document.querySelector(this.params.container) :
            this.params.container;

        if (!this.container) {
            throw new Error('Container element not found');
        }

        if (this.params.mediaContainer == null) {
            this.mediaContainer = this.container;
        } else if (typeof this.params.mediaContainer == 'string') {
            this.mediaContainer = document.querySelector(this.params.mediaContainer);
        } else {
            this.mediaContainer = this.params.mediaContainer;
        }

        if (!this.mediaContainer) {
            throw new Error('Media Container element not found');
        }

        // Used to save the current volume when muting so we can
        // restore once unmuted
        this.savedVolume = 0;

        // The current muted state
        this.isMuted = false;

        // Will hold a list of event descriptors that need to be
        // cancelled on subsequent loads of audio
        this.tmpEvents = [];

        // Holds any running audio downloads
        this.currentAjax = null;

        this.createDrawer();
        this.createBackend();
        this.createPeakCache();

        this.isDestroyed = false;
        my.on ('ready', function () {
            my.audioIsReady = true;
            if (my.progress !== undefined) { my.seekTo(my.progress); }
        });
    },

    createDrawer: function () {
        var my = this;
        this.drawer = Object.create(WaveSurfer.Drawer[this.params.renderer]);
        this.drawer.init(this.container, this.params, this.aliases);

        this.drawer.on('redraw', function () {
            my.drawBuffer();
            my.drawer.progress(my.backend.getPlayedPercents());
        });

        // Click-to-seek
        this.drawer.on('click', function (e, progress) {
            setTimeout(function () {
                my.seekTo(progress);
            }, 0);
        });

        // Relay the scroll event from the drawer
        this.drawer.on('scroll', function (e) {
            if (my.params.partialRender) {
                my.drawBuffer();
            }
            my.fireEvent('scroll', e);
        });
    },

    createBackend: function () {
        var my = this;

        if (this.backend) {
            this.backend.destroy();
        }

        // Back compat
        if (this.params.backend == 'AudioElement') {
            this.params.backend = 'MediaElement';
        }

        if (this.params.backend == 'WebAudio' && !WaveSurfer.WebAudio.supportsWebAudio()) {
            this.params.backend = 'MediaElement';
        }

        this.backend = Object.create(WaveSurfer[this.params.backend]);
        this.backend.init(this.params);

        this.backend.on('finish', function () { my.fireEvent('finish'); });
        this.backend.on('play', function () { my.fireEvent('play'); });
        this.backend.on('pause', function () { my.fireEvent('pause'); });

        this.backend.on('audioprocess', function (time) {
            my.drawer.progress(my.backend.getPlayedPercents());
            my.fireEvent('audioprocess', time);
        });
    },

    createPeakCache: function() {
        if (this.params.partialRender) {
            this.peakCache = Object.create(WaveSurfer.PeakCache);
            this.peakCache.init();
        }
    },

    getDuration: function () {
        return this.backend.getDuration();
    },

    getCurrentTime: function () {
        return this.backend.getCurrentTime();
    },

    play: function (start, end) {
        var my = this;
        if (my.audioIsReady == true) {
            action();
            return true;
        } else {
            this.tmpEvents.push(this.once('ready', action));
            return false;
        }
        function action () {
            my.fireEvent('interaction', my.play.bind(my, start, end));
            my.backend.play(start, end)
        }
    },

    pause: function () {
        return this.backend.isPaused() || this.backend.pause();
    },

    playPause: function () {
        return this.backend.isPaused() ? this.play() : this.pause();
    },

    isPlaying: function () {
        return !this.backend.isPaused();
    },

    skipBackward: function (seconds) {
        this.skip(-seconds || -this.params.skipLength);
    },

    skipForward: function (seconds) {
        this.skip(seconds || this.params.skipLength);
    },

    skip: function (offset) {
        var position = this.getCurrentTime() || 0;
        var duration = this.getDuration() || 1;
        position = Math.max(0, Math.min(duration, position + (offset || 0)));
        this.seekAndCenter(position / duration);
    },

    seekAndCenter: function (progress) {
        this.seekTo(progress);
        this.drawer.recenter(progress);
    },

    seekTo: function (progress) {
        this.progress = progress

        this.fireEvent('interaction', this.seekTo.bind(this, progress));

        var paused = this.backend.isPaused();
        // avoid draw wrong position while playing backward seeking
        if (!paused) {
            this.backend.pause();
        }
        // avoid small scrolls while paused seeking
        var oldScrollParent = this.params.scrollParent;
        this.params.scrollParent = false;
        this.backend.seekTo(progress * this.getDuration());
        this.drawer.progress(progress);

        if (!paused) {
            this.backend.play();
        }
        this.params.scrollParent = oldScrollParent;
        this.fireEvent('seek', progress);
    },

    stop: function () {
        this.pause();
        this.seekTo(0);
        this.drawer.progress(0);
    },

    /**
     * Set the playback volume.
     *
     * @param {Number} newVolume A value between 0 and 1, 0 being no
     * volume and 1 being full volume.
     */
    setVolume: function (newVolume) {
        this.backend.setVolume(newVolume);
    },

    /**
     * Get the playback volume.
     */
    getVolume: function () {
        return this.backend.getVolume();
    },

    /**
     * Set the playback rate.
     *
     * @param {Number} rate A positive number. E.g. 0.5 means half the
     * normal speed, 2 means double speed and so on.
     */
    setPlaybackRate: function (rate) {
        this.backend.setPlaybackRate(rate);
    },

    /**
     * Get the playback rate.
     */
    getPlaybackRate: function () {
        return this.backend.getPlaybackRate();
    },

    /**
     * Toggle the volume on and off. It not currenly muted it will
     * save the current volume value and turn the volume off.
     * If currently muted then it will restore the volume to the saved
     * value, and then rest the saved value.
     */
    toggleMute: function () {
        this.setMute(!this.isMuted);
    },

    setMute: function (mute) {
        // ignore all muting requests if the audio is already in that state
        if (mute === this.isMuted) {
            return;
        }

        if (mute) {
            // If currently not muted then save current volume,
            // turn off the volume and update the mute properties
            this.savedVolume = this.backend.getVolume();
            this.backend.setVolume(0);
            this.isMuted = true;
        } else {
            // If currently muted then restore to the saved volume
            // and update the mute properties
            this.backend.setVolume(this.savedVolume);
            this.isMuted = false;
        }
    },

    /**
     * Get the current mute status.
     */
    getMute: function () {
        return this.isMuted;
    },

    /**
     * Get the list of current set filters as an array.
     *
     * Filters must be set with setFilters method first
     */
    getFilters: function() {
        return this.backend.filters || [];
    },

    toggleScroll: function () {
        this.params.scrollParent = !this.params.scrollParent;
        this.drawBuffer();
    },

    toggleInteraction: function () {
        this.params.interact = !this.params.interact;
    },

    getComputedWidthAndRange: function () {
        var nominalWidth = Math.round(this.getDuration() * this.params.minPxPerSec * this.params.pixelRatio);
        var parentWidth = this.drawer.getWidth();

        // Fill container.
        if (this.params.fillParent && (!this.params.scrollParent || nominalWidth < parentWidth)) {
            var width = parentWidth;
            var start = 0;
            var end = width;
        } else {
            var width = nominalWidth;
            var start = this.drawer.getScrollX();
            var end = Math.min(start + parentWidth, width);
        }
        return { width: width, start: start, end: end };
    },

    drawBuffer: function () {
        var wse = this.getComputedWidthAndRange();
        var width = wse.width, start = wse.start, end = wse.end;

        if (this.params.partialRender) {
            var newRanges = this.peakCache.addRangeToPeakCache(width, start, end);
            for (var i = 0; i < newRanges.length; i++) {
              var peaks = this.backend.getPeaks(width, newRanges[i][0], newRanges[i][1]);
              this.drawer.drawPeaks(peaks, width, newRanges[i][0], newRanges[i][1]);
            }
        } else {
            if (!('peaks' in this.backend)) {
                var subrangeLength = width;
            } else {
                var numberOfChannels = this.backend.buffer ? this.backend.buffer.numberOfChannels :
                    this.backend.preload ? this.backend.preload.numberOfChannels :
                    (this.backend.peaks[0] instanceof Array) ? this.backend.peaks.length : 2;
                var subrangeLength = ((this.backend.peaks[0] instanceof Array) ? this.backend.peaks[0].length : this.backend.peaks.length) / numberOfChannels;
            }
            start = 0;
            end = subrangeLength - 1;
            var peaks = this.backend.getPeaks(subrangeLength, start, end);
            this.drawer.drawPeaks(peaks, width, start, end);
        }
        this.fireEvent('redraw', peaks, width);
    },

    zoom: function (pxPerSec) {
        this.params.minPxPerSec = pxPerSec;

        this.params.scrollParent = true;

        this.drawBuffer();
        this.drawer.progress(this.backend.getPlayedPercents());

        this.drawer.recenter(
            this.getCurrentTime() / this.getDuration()
        );
        this.fireEvent('zoom', pxPerSec);
    },

    /**
     * Internal method.
     */
    loadArrayBuffer: function (arraybuffer) {
        this.decodeArrayBuffer(arraybuffer, function (data) {
            if (!this.isDestroyed) {
                this.loadDecodedBuffer(data);
            }
        }.bind(this));
    },

    /**
     * Directly load an externally decoded AudioBuffer.
     */
    loadDecodedBuffer: function (buffer) {
        this.backend.load(buffer);
        this.drawBuffer();
        this.fireEvent('ready');
    },

    /**
     * Loads audio data from a Blob or File object.
     *
     * @param {Blob|File} blob Audio data.
     */
    loadBlob: function (blob) {
        var my = this;
        // Create file reader
        var reader = new FileReader();
        reader.addEventListener('progress', function (e) {
            my.onProgress(e);
        });
        reader.addEventListener('load', function (e) {
            my.loadArrayBuffer(e.target.result);
        });
        reader.addEventListener('error', function () {
            my.fireEvent('error', 'Error reading file');
        });
        reader.readAsArrayBuffer(blob);
        this.empty();
    },

    /**
     * Loads audio and re-renders the waveform.
     */
    load: function (url, peaks, preload, loadOnInteraction) {
        this.empty({drawPeaks: peaks === undefined});
        this.isMuted = false;

        switch (this.params.backend) {
            case 'WebAudio': return this.loadBuffer(url, peaks, true, loadOnInteraction);
            case 'MediaElement': return this.loadMediaElement(url, peaks, preload);
        }
    },

    /**
     * Loads audio using Web Audio buffer backend.
     */
    loadBuffer: function (url, peaks, preload, loadOnInteraction) {
        var load = (function (action) {
            if (action) {
                this.tmpEvents.push(this.once('ready', action));
            }
            return this.getArrayBuffer(url, this.loadArrayBuffer.bind(this));
        }).bind(this);

        if (peaks) {
            this.backend.setPeaks(peaks);
            this.drawBuffer();
        }
        if (loadOnInteraction) {
            this.tmpEvents.push(this.once('interaction', function (result) { load(result); }));
        } else {
            return load();
        }
    },

    /**
     *  Either create a media element, or load
     *  an existing media element.
     *  @param  {String|HTMLElement} urlOrElt Either a path to a media file,
     *                                          or an existing HTML5 Audio/Video
     *                                          Element
     *  @param  {Array}            [peaks]     Array of peaks. Required to bypass
     *                                          web audio dependency
     */
    loadMediaElement: function (urlOrElt, peaks, preload) {
        var url = urlOrElt;

        if (typeof urlOrElt === 'string') {
            this.backend.load(url, this.mediaContainer, peaks, preload);
        } else {
            var elt = urlOrElt;
            this.backend.loadElt(elt, peaks);

            // If peaks are not provided,
            // url = element.src so we can get peaks with web audio
            url = elt.src;
        }

        this.tmpEvents.push(
            this.backend.once('canplay', (function () {
                this.drawBuffer();
                this.fireEvent('ready');
            }).bind(this)),

            this.backend.once('error', (function (err) {
                this.fireEvent('error', err);
            }).bind(this))
        );

        // If no pre-decoded peaks provided or pre-decoded peaks are
        // provided with forceDecode flag, attempt to download the
        // audio file and decode it with Web Audio.
        if (peaks) { this.backend.setPeaks(peaks); }

        if ((!peaks || this.params.forceDecode) && this.backend.supportsWebAudio()) {
            this.getArrayBuffer(url, (function (arraybuffer) {
                this.decodeArrayBuffer(arraybuffer, (function (buffer) {
                    this.backend.buffer = buffer;
                    this.backend.setPeaks(null);
                    this.drawBuffer();
                    this.fireEvent('waveform-ready');
                }).bind(this));
            }).bind(this));
        }
    },

    decodeArrayBuffer: function (arraybuffer, callback) {
        this.arraybuffer = arraybuffer;

        this.backend.decodeArrayBuffer(
            arraybuffer,
            (function (data) {
                // Only use the decoded data if we haven't been destroyed or another decode started in the meantime
                if (!this.isDestroyed && this.arraybuffer == arraybuffer) {
                    callback(data);
                    this.arraybuffer = null;
                }
            }).bind(this),
            this.fireEvent.bind(this, 'error', 'Error decoding audiobuffer')
        );
    },

    getArrayBuffer: function (url, callback) {
        var my = this;

        var ajax = WaveSurfer.util.ajax({
            url: url,
            responseType: 'arraybuffer'
        });

        this.currentAjax = ajax;

        this.tmpEvents.push(
            ajax.on('progress', function (e) {
                my.onProgress(e);
            }),
            ajax.on('success', function (data, e) {
                callback(data);
                my.currentAjax = null;
            }),
            ajax.on('error', function (e) {
                my.fireEvent('error', 'XHR error: ' + e.target.statusText);
                my.currentAjax = null;
            })
        );

        return ajax;
    },

    onProgress: function (e) {
        if (e.lengthComputable) {
            var percentComplete = e.loaded / e.total;
        } else {
            // Approximate progress with an asymptotic
            // function, and assume downloads in the 1-3 MB range.
            percentComplete = e.loaded / (e.loaded + 1000000);
        }
        this.fireEvent('loading', Math.round(percentComplete * 100), e.target);
    },

    /**
     * Exports PCM data into a JSON array and opens in a new window.
     */
    exportPCM: function (length, accuracy, noWindow, start) {
        length = length || 1024;
        accuracy = accuracy || 10000;
        noWindow = noWindow || false;
        var peaks = this.backend.getPeaks(length, start, length - 1);
        var arr = [].map.call(peaks, function (val) {
            return Math.round(val * accuracy) / accuracy;
        });
        var json = JSON.stringify(arr);
        if (!noWindow) {
            window.open('data:application/json;charset=utf-8,' +
                encodeURIComponent(json));
        }
        return json;
    },

    /**
     * Save waveform image as data URI.
     *
     * The default format is 'image/png'. Other supported types are
     * 'image/jpeg' and 'image/webp'.
     */
    exportImage: function(format, quality) {
        if (!format) {
            format = 'image/png';
        }
        if (!quality) {
            quality = 1;
        }

        return this.drawer.getImage(format, quality);
    },

    cancelAjax: function () {
        if (this.currentAjax) {
            this.currentAjax.xhr.abort();
            this.currentAjax = null;
        }
    },

    clearTmpEvents: function () {
        this.tmpEvents.forEach(function (e) { e.un(); });
    },

    /**
     * Display empty waveform.
     */
    empty: function (init) {
        init = init || {};
        if (!this.backend.isPaused()) {
            this.stop();
            this.backend.disconnectSource();
        }
        this.cancelAjax();
        this.clearTmpEvents();
        this.drawer.progress(0);
        this.drawer.setWidth(0);
        if (!('drawPeaks' in init) || (init.drawPeaks == true)) { this.drawer.drawPeaks({ length: this.drawer.getWidth() }, 0); }
    },

    /**
     * Remove events, elements and disconnect WebAudio nodes.
     */
    destroy: function () {
        this.fireEvent('destroy');
        this.cancelAjax();
        this.clearTmpEvents();
        this.unAll();
        this.backend.destroy();
        this.drawer.destroy();
        this.isDestroyed = true;
    }
};

WaveSurfer.create = function (params) {
    var wavesurfer = Object.create(WaveSurfer);
    wavesurfer.init(params);
    return wavesurfer;
};

/* Common utilities */
WaveSurfer.util = {
    requestAnimationFrame: (
        window.requestAnimationFrame ||
        window.webkitRequestAnimationFrame ||
        window.mozRequestAnimationFrame ||
        window.oRequestAnimationFrame ||
        window.msRequestAnimationFrame ||
        function (callback, element) { setTimeout(callback, 1000 / 60); }
    ).bind(window),

    frame: function (func) {
        return function () {
            var my = this, args = arguments;
            WaveSurfer.util.requestAnimationFrame(function () {
                func.apply(my, args);
            });
        };
    },

    extend: function (dest) {
        var sources = Array.prototype.slice.call(arguments, 1);
        sources.forEach(function (source) {
            Object.keys(source).forEach(function (key) {
                dest[key] = source[key];
            });
        });
        return dest;
    },

    deepMerge: function (target, obj, level) {
        if (obj === null || typeof(obj) != 'object' || 'isActiveClone' in obj) { return (typeof(target) != 'object') ? obj : target; }
        if (target === null || typeof(target) != 'object') {
            var target = (obj instanceof Date) ? new obj.constructor() : obj.constructor();
        }
        for (var key in obj) {
            if (!Object.prototype.hasOwnProperty.call(obj, key)) { continue; }
            obj.isActiveClone = null;
            if (obj[key] instanceof Element || (level !== undefined && level == 0)) {
                target[key] = obj[key];
            } else {
                target[key] = this.deepMerge(target[key], obj[key], level === undefined ? undefined : level - 1);
            }
            delete obj.isActiveClone;
        }
        return target;
    },

    setAliases: function (init) {
        var targetObject = init.target.object, targetProperty = init.target.property;
        if (init.styleSource) {
            var setExtra = function (n) { styleSourceObject[styleSourceProperty] = n; };
            var styleSourceObject = init.styleSource.object, styleSourceProperty = init.styleSource.property;
            var styleSourcePropertyUnderscore = styleSourceProperty.replace(/([A-Z])/g, '-$1').toLowerCase();
            Object.defineProperty(styleSourceObject, styleSourceProperty, {
                get: function () { return this.getPropertyValue(styleSourcePropertyUnderscore); },
                set: function (n) {targetObject[targetProperty] = n; this.setProperty(styleSourcePropertyUnderscore, n); }
            });
        }
        init.sourceList.forEach(function (source) {
            if (source.get) {
                var get = function () { return source.get(targetObject[targetProperty]); };
            } else {
                var get = function () { return targetObject[targetProperty]; };
            }
            if (source.set) {
                if (setExtra) {
                    var set = function (value) { setExtra(value); targetObject[targetProperty] = source.set(value); };
                } else {
                    var set = function (value) { targetObject[targetProperty] = source.set(value); };
                }
            } else {
                if (setExtra) {
                    var set = function (value) { setExtra(value); targetObject[targetProperty] = value; };
                } else {
                    var set = function (value) { targetObject[targetProperty] = value; };
                }
            }
            Object.defineProperty(source.object, source.property, { configurable: true, get: get, set: set });
        });
    },

    refreshAliases: function (aliases, changes) {
        for (var aliasName in aliases) {
            var alias = aliases[aliasName];
            if (changes && changes[aliasName]) { WaveSurfer.util.deepMerge(alias, changes[aliasName], 1); }
            WaveSurfer.util.setAliases(alias);
        }
    },

    debounce: function (func, wait, immediate) {
        var args, context, timeout;
        var later = function() {
            timeout = null;
            if (!immediate) {
                func.apply(context, args);
            }
        };
        return function() {
            context = this;
            args = arguments;
            var callNow = immediate && !timeout;
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
            if (!timeout) {
                timeout = setTimeout(later, wait);
            }
            if (callNow) {
                func.apply(context, args);
            }
        };
    },

    min: function (values) {
        var min = +Infinity;
        for (var i in values) {
            if (values[i] < min) {
                min = values[i];
            }
        }

        return min;
    },

    max: function (values) {
        var max = -Infinity;
        for (var i in values) {
            if (values[i] > max) {
                max = values[i];
            }
        }

        return max;
    },

    getId: function () {
        return 'wavesurfer_' + Math.random().toString(32).substring(2);
    },

    ajax: function (options) {
        var ajax = Object.create(WaveSurfer.Observer);
        var xhr = new XMLHttpRequest();
        var fired100 = false;

        xhr.open(options.method || 'GET', options.url, true);
        xhr.responseType = options.responseType || 'json';

        xhr.addEventListener('progress', function (e) {
            ajax.fireEvent('progress', e);
            if (e.lengthComputable && e.loaded == e.total) {
                fired100 = true;
            }
        });

        xhr.addEventListener('load', function (e) {
            if (!fired100) {
                ajax.fireEvent('progress', e);
            }
            ajax.fireEvent('load', e);

            if (200 == xhr.status || 206 == xhr.status) {
                ajax.fireEvent('success', xhr.response, e);
            } else {
                ajax.fireEvent('error', e);
            }
        });

        xhr.addEventListener('error', function (e) {
            ajax.fireEvent('error', e);
        });

        xhr.send();
        ajax.xhr = xhr;
        return ajax;
    }
};

/* Observer */
WaveSurfer.Observer = {
    /**
     * Attach a handler function for an event.
     */
    on: function (event, fn) {
        if (!this.handlers) { this.handlers = {}; }

        var handlers = this.handlers[event];
        if (!handlers) {
            handlers = this.handlers[event] = [];
        }
        handlers.push(fn);

        // Return an event descriptor
        return {
            name: event,
            callback: fn,
            un: this.un.bind(this, event, fn)
        };
    },

    /**
     * Remove an event handler.
     */
    un: function (event, fn) {
        if (!this.handlers) { return; }

        var handlers = this.handlers[event];
        if (handlers) {
            if (fn) {
                for (var i = handlers.length - 1; i >= 0; i--) {
                    if (handlers[i] == fn) {
                        handlers.splice(i, 1);
                    }
                }
            } else {
                handlers.length = 0;
            }
        }
    },

    /**
     * Remove all event handlers.
     */
    unAll: function () {
        this.handlers = null;
    },

    /**
     * Attach a handler to an event. The handler is executed at most once per
     * event type.
     */
    once: function (event, handler) {
        var my = this;
        var fn = function () {
            handler.apply(this, arguments);
            setTimeout(function () {
                my.un(event, fn);
            }, 0);
        };
        return this.on(event, fn);
    },

    fireEvent: function (event) {
        if (!this.handlers) { return; }
        var handlers = this.handlers[event];
        var args = Array.prototype.slice.call(arguments, 1);
        handlers && handlers.forEach(function (fn) {
            fn.apply(null, args);
        });
    }
};

/* Make the main WaveSurfer object an observer */
WaveSurfer.util.extend(WaveSurfer, WaveSurfer.Observer);

'use strict';

WaveSurfer.WebAudio = {
    scriptBufferSize: 256,
    PLAYING_STATE: 0,
    PAUSED_STATE: 1,
    FINISHED_STATE: 2,

    supportsWebAudio: function () {
        return !!(window.AudioContext || window.webkitAudioContext);
    },

    getAudioContext: function () {
        if (!WaveSurfer.WebAudio.audioContext) {
            WaveSurfer.WebAudio.audioContext = new (
                window.AudioContext || window.webkitAudioContext
            );
        }
        return WaveSurfer.WebAudio.audioContext;
    },

    getOfflineAudioContext: function (sampleRate) {
        if (!WaveSurfer.WebAudio.offlineAudioContext) {
            WaveSurfer.WebAudio.offlineAudioContext = new (
                window.OfflineAudioContext || window.webkitOfflineAudioContext
            )(1, 2, sampleRate);
        }
        return WaveSurfer.WebAudio.offlineAudioContext;
    },

    init: function (params) {
        this.params = params;
        this.ac = params.audioContext || this.getAudioContext();

        this.lastPlay = this.ac.currentTime;
        this.startPosition = 0;
        this.scheduledPause = null;

        this.states = [
            Object.create(WaveSurfer.WebAudio.state.playing),
            Object.create(WaveSurfer.WebAudio.state.paused),
            Object.create(WaveSurfer.WebAudio.state.finished)
        ];

        this.createVolumeNode();
        this.createScriptNode();
        this.createAnalyserNode();

        this.setState(this.PAUSED_STATE);
        this.setPlaybackRate(this.params.audioRate);
        this.setLength(0);
    },

    disconnectFilters: function () {
        if (this.filters) {
            this.filters.forEach(function (filter) {
                filter && filter.disconnect();
            });
            this.filters = null;
            // Reconnect direct path
            this.analyser.connect(this.gainNode);
        }
    },

    setState: function (state) {
        if (this.state !== this.states[state]) {
            this.state = this.states[state];
            this.state.init.call(this);
        }
    },

    // Unpacked filters
    setFilter: function () {
        this.setFilters([].slice.call(arguments));
    },

    /**
     * @param {Array} filters Packed ilters array
     */
    setFilters: function (filters) {
        // Remove existing filters
        this.disconnectFilters();

        // Insert filters if filter array not empty
        if (filters && filters.length) {
            this.filters = filters;

            // Disconnect direct path before inserting filters
            this.analyser.disconnect();

            // Connect each filter in turn
            filters.reduce(function (prev, curr) {
                prev.connect(curr);
                return curr;
            }, this.analyser).connect(this.gainNode);
        }

    },

    createScriptNode: function () {
        if (this.ac.createScriptProcessor) {
            this.scriptNode = this.ac.createScriptProcessor(this.scriptBufferSize);
        } else {
            this.scriptNode = this.ac.createJavaScriptNode(this.scriptBufferSize);
        }

        this.scriptNode.connect(this.ac.destination);
    },

    addOnAudioProcess: function () {
        var my = this;

        this.scriptNode.onaudioprocess = function () {
            var time = my.getCurrentTime();

            if (time >= my.getDuration()) {
                my.setState(my.FINISHED_STATE);
                my.fireEvent('pause');
            } else if (time >= my.scheduledPause) {
                my.pause();
            } else if (my.state === my.states[my.PLAYING_STATE]) {
                my.fireEvent('audioprocess', time);
            }
        };
    },

    removeOnAudioProcess: function () {
        this.scriptNode.onaudioprocess = null;
    },

    createAnalyserNode: function () {
        this.analyser = this.ac.createAnalyser();
        this.analyser.connect(this.gainNode);
    },

    /**
     * Create the gain node needed to control the playback volume.
     */
    createVolumeNode: function () {
        // Create gain node using the AudioContext
        if (this.ac.createGain) {
            this.gainNode = this.ac.createGain();
        } else {
            this.gainNode = this.ac.createGainNode();
        }
        // Add the gain node to the graph
        this.gainNode.connect(this.ac.destination);
    },

    /**
     * Set the gain to a new value.
     *
     * @param {Number} newGain The new gain, a floating point value
     * between 0 and 1. 0 being no gain and 1 being maximum gain.
     */
    setVolume: function (newGain) {
        this.gainNode.gain.value = newGain;
    },

    /**
     * Get the current gain.
     *
     * @returns {Number} The current gain, a floating point value
     * between 0 and 1. 0 being no gain and 1 being maximum gain.
     */
    getVolume: function () {
        return this.gainNode.gain.value;
    },

    decodeArrayBuffer: function (arraybuffer, callback, errback) {
        if (!this.offlineAc) {
            this.offlineAc = this.getOfflineAudioContext(this.ac ? this.ac.sampleRate : 44100);
        }
        this.offlineAc.decodeAudioData(arraybuffer, (function (data) {
            callback(data);
        }).bind(this), errback);
    },

    /**
     * Set pre-decoded peaks.
     */
    setPeaks: function (peaks) {
        this.peaks = peaks;
    },

    /**
     * Set the rendered length (different from the length of the audio).
     */
    setLength: function (length) {
        // No resize, we can preserve the cached peaks.
        if (this.mergedPeaks && length == ((2 * this.mergedPeaks.length - 1) + 2)) {
          return;
        }

        this.splitPeaks = [];
        this.mergedPeaks = [];
        // Set the last element of the sparse array so the peak arrays are
        // appropriately sized for other calculations.
        var channels = this.buffer ? this.buffer.numberOfChannels : 1;
        for (var c = 0; c < channels; c++) {
          this.splitPeaks[c] = [];
          this.splitPeaks[c][2 * (length - 1)] = 0;
          this.splitPeaks[c][2 * (length - 1) + 1] = 0;
        }
        this.mergedPeaks[2 * (length - 1)] = 0;
        this.mergedPeaks[2 * (length - 1) + 1] = 0;
    },

    /**
     * Compute the max and min value of the waveform when broken into
     * <length> subranges.
     * @param {Number} length How many subranges to break the waveform into.
     * @param {Number} first First sample in the required range.
     * @param {Number} last Last sample in the required range.
     * @returns {Array} Array of 2*<length> peaks or array of arrays
     * of peaks consisting of (max, min) values for each subrange.
     */
    getPeaks: function (length, first, last) {
        first = first || 0;
        last = last || length - 1;
        if (this.peaks) { return this.peaks; }
        this.setLength(length);
        var sampleSize = this.buffer.length / length;
        var sampleStep = ~~(sampleSize / 10) || 1;
        var channels = this.buffer.numberOfChannels;
        for (var c = 0; c < channels; c++) {
            var peaks = this.splitPeaks[c];
            var chan = this.buffer.getChannelData(c);
            for (var i = first; i <= last; i++) {
                var start = ~~(i * sampleSize);
                var end = ~~(start + sampleSize);
                var min = 0, max = 0;
                for (var j = start; j < end; j += sampleStep) {
                    var value = chan[j];
                    if (max < value) { max = value; } else if (min > value) { min = value; }
                }
                peaks[2 * i] = max;
                peaks[2 * i + 1] = min;
                if (c == 0 || max > this.mergedPeaks[2 * i]) { this.mergedPeaks[2 * i] = max; }
                if (c == 0 || min < this.mergedPeaks[2 * i + 1]) { this.mergedPeaks[2 * i + 1] = min; }
            }
        }
        return this.params.splitChannels ? this.splitPeaks : this.mergedPeaks;
    },

    getPlayedPercents: function () {
        return this.state.getPlayedPercents.call(this);
    },

    disconnectSource: function () {
        if (this.source) {
            this.source.disconnect();
        }
    },

    destroy: function () {
        if (!this.isPaused()) {
            this.pause();
        }
        this.unAll();
        this.buffer = null;
        this.disconnectFilters();
        this.disconnectSource();
        this.gainNode.disconnect();
        this.scriptNode.disconnect();
        this.analyser.disconnect();
        // close the audioContext if closeAudioContext option is set to true
        if (this.params.closeAudioContext) {
            // check if browser supports AudioContext.close()
            if (typeof this.ac.close === 'function' && this.ac.state != 'closed') {
                this.ac.close();
            }
            // clear the reference to the audiocontext
            this.ac = null;
            // clear the actual audiocontext, either passed as param or the
            // global singleton
            if (!this.params.audioContext) {
                WaveSurfer.WebAudio.audioContext = null;
            } else {
                this.params.audioContext = null;
            }
            // clear the offlineAudioContext
            WaveSurfer.WebAudio.offlineAudioContext = null;
        }
    },

    load: function (buffer) {
        this.startPosition = 0;
        this.lastPlay = this.ac.currentTime;
        this.buffer = buffer;
        this.createSource();
    },

    createSource: function () {
        this.disconnectSource();
        this.source = this.ac.createBufferSource();

        //adjust for old browsers.
        this.source.start = this.source.start || this.source.noteGrainOn;
        this.source.stop = this.source.stop || this.source.noteOff;

        this.source.playbackRate.value = this.playbackRate;
        this.source.buffer = this.buffer;
        this.source.connect(this.analyser);
    },

    isPaused: function () {
        return this.state !== this.states[this.PLAYING_STATE];
    },

    getDuration: function () {
        if (!this.buffer) {
            return 0;
        }
        return this.buffer.duration;
    },

    seekTo: function (start, end) {
        if (!this.buffer) { return; }

        this.scheduledPause = null;

        if (start == null) {
            start = this.getCurrentTime();
            if (start >= this.getDuration()) {
                start = 0;
            }
        }
        if (end == null) {
            end = this.getDuration();
        }

        this.startPosition = start;
        this.lastPlay = this.ac.currentTime;

        if (this.state === this.states[this.FINISHED_STATE]) {
            this.setState(this.PAUSED_STATE);
        }

        return { start: start, end: end };
    },

    getPlayedTime: function () {
        return (this.ac.currentTime - this.lastPlay) * this.playbackRate;
    },

    /**
     * Plays the loaded audio region.
     *
     * @param {Number} start Start offset in seconds,
     * relative to the beginning of a clip.
     * @param {Number} end When to stop
     * relative to the beginning of a clip.
     */
    play: function (start, end) {
        if (!this.buffer) { return; }

        // need to re-create source on each playback
        this.createSource();
        var adjustedTime = this.seekTo(start, end);

        start = adjustedTime.start;
        end = adjustedTime.end;

        this.scheduledPause = end;

        this.source.start(0, start, end - start);

        if (this.ac.state == 'suspended') {
          this.ac.resume && this.ac.resume();
        }

        this.setState(this.PLAYING_STATE);

        this.fireEvent('play');
    },

    /**
     * Pauses the loaded audio.
     */
    pause: function () {
        this.scheduledPause = null;

        this.startPosition += this.getPlayedTime();
        this.source && this.source.stop(0);

        this.setState(this.PAUSED_STATE);

        this.fireEvent('pause');
    },

    /**
    *   Returns the current time in seconds relative to the audioclip's duration.
    */
    getCurrentTime: function () {
        return this.state.getCurrentTime.call(this);
    },

    /**
    *   Returns the current playback rate.
    */
    getPlaybackRate: function () {
        return this.playbackRate;
    },

    /**
     * Set the audio source playback rate.
     */
    setPlaybackRate: function (value) {
        value = value || 1;
        if (this.isPaused()) {
            this.playbackRate = value;
        } else {
            this.pause();
            this.playbackRate = value;
            this.play();
        }
    }
};

WaveSurfer.WebAudio.state = {};

WaveSurfer.WebAudio.state.playing = {
    init: function () {
        this.addOnAudioProcess();
    },
    getPlayedPercents: function () {
        var duration = this.getDuration();
        return (this.getCurrentTime() / duration) || 0;
    },
    getCurrentTime: function () {
        return this.startPosition + this.getPlayedTime();
    }
};

WaveSurfer.WebAudio.state.paused = {
    init: function () {
        this.removeOnAudioProcess();
    },
    getPlayedPercents: function () {
        var duration = this.getDuration();
        return (this.getCurrentTime() / duration) || 0;
    },
    getCurrentTime: function () {
        return this.startPosition;
    }
};

WaveSurfer.WebAudio.state.finished = {
    init: function () {
        this.removeOnAudioProcess();
        this.fireEvent('finish');
    },
    getPlayedPercents: function () {
        return 1;
    },
    getCurrentTime: function () {
        return this.getDuration();
    }
};

WaveSurfer.util.extend(WaveSurfer.WebAudio, WaveSurfer.Observer);

'use strict';

WaveSurfer.MediaElement = Object.create(WaveSurfer.WebAudio);

WaveSurfer.util.extend(WaveSurfer.MediaElement, {
    init: function (params) {
        this.params = params;

        // Dummy media to catch errors
        this.media = {
            currentTime: 0,
            duration: 0,
            paused: true,
            playbackRate: 1,
            play: function () {},
            pause: function () {}
        };

        this.mediaType = params.mediaType.toLowerCase();
        this.elementPosition = params.elementPosition;
        this.setPlaybackRate(this.params.audioRate);
        this.createTimer();
    },


    /**
     * Create a timer to provide a more precise `audioprocess' event.
     */
    createTimer: function () {
        var my = this;
        var playing = false;

        var onAudioProcess = function () {
            if (my.isPaused()) { return; }

            my.fireEvent('audioprocess', my.getCurrentTime());

            // Call again in the next frame
            var requestAnimationFrame = window.requestAnimationFrame || window.webkitRequestAnimationFrame;
            requestAnimationFrame(onAudioProcess);
        };

        this.on('play', onAudioProcess);
    },

    /**
     *  Create media element with url as its source,
     *  and append to container element.
     *  @param  {String}        url         path to media file
     *  @param  {HTMLElement}   container   HTML element
     *  @param  {Array}         peaks       array of peak data
     *  @param  {String}        preload     HTML 5 preload attribute value
     */
    load: function (url, container, peaks, preload) {
        var my = this;

        var media = document.createElement(this.mediaType);
        media.controls = this.params.mediaControls;
        media.autoplay = this.params.autoplay || false;
        media.preload = preload == null ? 'auto' : preload;
        media.src = url;
        media.style.width = '100%';

        var prevMedia = container.querySelector(this.mediaType);
        if (prevMedia) {
            container.removeChild(prevMedia);
        }
        container.appendChild(media);

        this._load(media, peaks);
    },

    /**
     *  Load existing media element.
     *  @param  {MediaElement}  elt     HTML5 Audio or Video element
     *  @param  {Array}         peaks   array of peak data
     */
    loadElt: function (elt, peaks) {
        var my = this;

        var media = elt;
        media.controls = this.params.mediaControls;
        media.autoplay = this.params.autoplay || false;

        this._load(media, peaks);
    },

    /**
     *  Private method called by both load (from url)
     *  and loadElt (existing media element).
     *  @param  {MediaElement}  media     HTML5 Audio or Video element
     *  @param  {Array}         peaks   array of peak data
     *  @private
     */
    _load: function (media, peaks) {
        var my = this;
        // load must be called manually on iOS; otherwise, peaks won't draw
        // until a user interaction triggers load --> 'ready' event
        if (typeof media.load == 'function') {
            media.load();
        }

        media.addEventListener('error', function () {
            my.fireEvent('error', 'Error loading media element');
        });

        media.addEventListener('canplay', function () {
            my.fireEvent('canplay');
        });

        media.addEventListener('ended', function () {
            my.fireEvent('finish');
        });

        this.media = media;
        this.peaks = peaks;
        this.onPlayEnd = null;
        this.buffer = null;
        this.setPlaybackRate(this.playbackRate);
    },

    isPaused: function () {
        return !this.media || this.media.paused;
    },

    getDuration: function () {
        var duration = (this.buffer || this.media).duration;
        if (duration >= Infinity) { // streaming audio
            duration = this.media.seekable.end(0);
        }
        return duration;
    },

    getCurrentTime: function () {
        return this.media && this.media.currentTime;
    },

    getPlayedPercents: function () {
        return (this.getCurrentTime() / this.getDuration()) || 0;
    },

    getPlaybackRate: function () {
        return this.playbackRate || this.media.playbackRate;
    },

    /**
     * Set the audio source playback rate.
     */
    setPlaybackRate: function (value) {
        this.playbackRate = value || 1;
        this.media.playbackRate = this.playbackRate;
    },

    seekTo: function (start) {
        if (start != null) {
            this.media.currentTime = start;
        }
        this.clearPlayEnd();
    },

    /**
     * Plays the loaded audio region.
     *
     * @param {Number} start Start offset in seconds,
     * relative to the beginning of a clip.
     * @param {Number} end End offset in seconds,
     * relative to the beginning of a clip.
     */
    play: function (start, end) {
        this.seekTo(start);
        this.media.play();
        end && this.setPlayEnd(end);
        this.fireEvent('play');
    },

    /**
     * Pauses the loaded audio.
     */
    pause: function () {
        this.media && this.media.pause();
        this.clearPlayEnd();
        this.fireEvent('pause');
    },

    setPlayEnd: function (end) {
        var my = this;
        this.onPlayEnd = function (time) {
            if (time >= end) {
                my.pause();
                my.seekTo(end);
            }
        };
        this.on('audioprocess', this.onPlayEnd);
    },

    clearPlayEnd: function () {
        if (this.onPlayEnd) {
            this.un('audioprocess', this.onPlayEnd);
            this.onPlayEnd = null;
        }
    },

    getPeaks: function (length, start, end) {
        if (this.buffer) {
            return WaveSurfer.WebAudio.getPeaks.call(this, length, start, end);
        }
        return this.peaks || [];
    },

    getVolume: function () {
        return this.media.volume;
    },

    setVolume: function (val) {
        this.media.volume = val;
    },

    destroy: function () {
        this.pause();
        this.unAll();
        this.media && this.media.parentNode && this.media.parentNode.removeChild(this.media);
        this.media = null;
    }
});

//For backwards compatibility
WaveSurfer.AudioElement = WaveSurfer.MediaElement;

'use strict';

WaveSurfer.Drawer = {
    init: function (container, params, aliases) {
        this.container = container;
        this.params = params;
        this.aliases = aliases;

        this.width = 0;
        this.height = params.height * this.params.pixelRatio;

        this.lastPos = 0;

        this.initDrawer(params);
        this.createWrapper();
        this.createElements();
    },

    createWrapper: function () {
        this.wrapper = this.container.appendChild(
            document.createElement('wave')
        );

        this.style(this.wrapper, {
            display: 'block',
            position: 'relative',
            userSelect: 'none',
            webkitUserSelect: 'none',
            height: this.params.height + 'px'
        });

        if (this.params.fillParent || this.params.scrollParent) {
            this.style(this.wrapper, {
                width: '100%',
                overflowX: this.params.hideScrollbar ? 'hidden' : 'auto',
                overflowY: 'hidden'
            });
        }

        this.setupWrapperEvents();
    },

    handleEvent: function (e, noPrevent) {
        !noPrevent && e.preventDefault();

        var clientX = e.targetTouches ? e.targetTouches[0].clientX : e.clientX;
        var bbox = this.wrapper.getBoundingClientRect();

        var nominalWidth = this.width;
        var parentWidth = this.getWidth();

        if (!this.params.fillParent && nominalWidth < parentWidth) {
            var numerator = (clientX - bbox.left) * this.params.pixelRatio;
            var denominator = nominalWidth - 1;
        } else {
            var numerator = (clientX - bbox.left + this.wrapper.scrollLeft);
            var denominator = this.wrapper.scrollWidth - 1;
        }
        // The clicked pixel is never equal the width. It's always 1 pixel less.
        // A 100-pixel element can be clicked at position 0 through position 99. And the range must include 0 as well as 1.
        // Thus, clicking at the 100th pixel (99) means progress is 1, not 99/100 or .99.
        var progress = (numerator > denominator) ? 1 : (numerator / denominator || 0);
        return progress;
    },

    setupWrapperEvents: function () {
        var my = this;

        this.wrapper.addEventListener('click', function (e) {
            var scrollbarHeight = my.wrapper.offsetHeight - my.wrapper.clientHeight;
            if (scrollbarHeight != 0) {
                // scrollbar is visible.  Check if click was on it
                var bbox = my.wrapper.getBoundingClientRect();
                if (e.clientY >= bbox.bottom - scrollbarHeight) {
                    // ignore mousedown as it was on the scrollbar
                    return;
                }
            }

            if (my.params.interact) {
                my.fireEvent('click', e, my.handleEvent(e));
            }
        });

        this.wrapper.addEventListener('scroll', function (e) {
            my.fireEvent('scroll', e);
        });
    },

    drawPeaks: WaveSurfer.util.frame(function (peaks, length, start, end) {
        var my = this;

        my.setWidth(length);

        // Clear the canvas.
        my.clearCanvas();

        // Run the draw function if there are no channels to split. Otherwise, split the channels.
        if (!my.params.splitChannels) {
            drawFunction(peaks, 0);
        } else {
            var channels = peaks;
            my.setHeight(channels.length * my.params.height * my.params.pixelRatio);
            channels.forEach(function(channelPeaks, channelIndex) {drawFunction(peaks, channelIndex); });
        }

        function drawFunction (peaks, channelIndex) {
            // Extract peaks if they are in an array.
            if (peaks[0] instanceof Array) { peaks = peaks[0]; }
            my[my.params.barWidth ? "drawBars" : "drawWave"](peaks, channelIndex, start, end);
        }
    }),

    style: function (el, styles) {
        Object.keys(styles).forEach(function (prop) {
            if (el.style[prop] !== styles[prop]) {
                el.style[prop] = styles[prop];
            }
        });
        return el;
    },

    resetScroll: function () {
        if (this.wrapper !== null) {
            this.wrapper.scrollLeft = 0;
        }
    },

    recenter: function (percent) {
        var position = this.wrapper.scrollWidth * percent;
        this.recenterOnPosition(position, true);
    },

    recenterOnPosition: function (position, immediate) {
        var scrollLeft = this.wrapper.scrollLeft;
        var half = ~~(this.wrapper.clientWidth / 2);
        var target = position - half;
        var offset = target - scrollLeft;
        var maxScroll = this.wrapper.scrollWidth - this.wrapper.clientWidth;

        if (maxScroll == 0) {
            // no need to continue if scrollbar is not there
            return;
        }

        // if the cursor is currently visible...
        if (!immediate && -half <= offset && offset < half) {
            // we'll limit the "re-center" rate.
            var rate = 5;
            offset = Math.max(-rate, Math.min(rate, offset));
            target = scrollLeft + offset;
        }

        // limit target to valid range (0 to maxScroll)
        target = Math.max(0, Math.min(maxScroll, target));
        // no use attempting to scroll if we're not moving
        if (target != scrollLeft) {
            this.wrapper.scrollLeft = target;
        }

    },

    getScrollX: function() {
        return Math.round(this.wrapper.scrollLeft * this.params.pixelRatio);
    },

    getWidth: function () {
        return Math.round(this.container.clientWidth * this.params.pixelRatio);
    },

    setWidth: function (width) {
        if (this.width == width) { return; }

        this.width = width;

        if (this.params.fillParent || this.params.scrollParent) {
            this.style(this.wrapper, {
                width: ''
            });
        } else {
            this.style(this.wrapper, {
                width: ~~(this.width / this.params.pixelRatio) + 'px'
            });
        }

        this.updateSize();
    },

    setHeight: function (height) {
        if (height == this.height) { return; }
        this.height = height;
        this.style(this.wrapper, {
            height: ~~(this.height / this.params.pixelRatio) + 'px'
        });
        this.updateSize();
    },

    progress: function (progress) {
        var minPxDelta = 1 / this.params.pixelRatio;
        var pos = Math.ceil(progress * this.width) * minPxDelta;
        if (pos < this.lastPos || pos - this.lastPos >= minPxDelta) {
            this.lastPos = pos;

            if (this.params.scrollParent && this.params.autoCenter) {
                var newPos = ~~(this.wrapper.scrollWidth * progress);
                this.recenterOnPosition(newPos);
            }

            this.updateProgress(pos);
        }
    },

    destroy: function () {
        this.unAll();
        if (this.wrapper) {
            if (this.wrapper.parentNode == this.container) this.container.removeChild(this.wrapper);
            this.wrapper = null;
        }
    },

    /* Renderer-specific methods */
    initDrawer: function () {},

    createElements: function () {},

    updateSize: function () {},

    drawWave: function (peaks, max) {},

    clearCanvas: function () {},

    updateProgress: function (position) {}
};

WaveSurfer.util.extend(WaveSurfer.Drawer, WaveSurfer.Observer);

'use strict';

WaveSurfer.Drawer.MultiCanvas = Object.create(WaveSurfer.Drawer);

WaveSurfer.util.extend(WaveSurfer.Drawer.MultiCanvas, {
    initDrawer: function (params) {
        this.maxCanvasWidth = params.maxCanvasWidth != null ? params.maxCanvasWidth : 4000;
        this.maxCanvasElementWidth = Math.round(this.maxCanvasWidth / this.params.pixelRatio);

        if (this.maxCanvasWidth <= 1) {
            throw 'maxCanvasWidth must be greater than 1.';
        } else if (this.maxCanvasWidth % 2 == 1) {
            throw 'maxCanvasWidth must be an even number.';
        }

        this.hasProgressCanvas = this.params.waveColor != this.params.progressColor;
        this.halfPixel = 0.5 / this.params.pixelRatio;
        this.canvases = [];
    },

    createElements: function () {
        var params = this.params;
        ['progressWave', 'wave'].forEach(function (waveType) {
            this[waveType] = this.wrapper.appendChild(
                this.style(document.createElement('wave'), Object.assign({}, params.styleList[waveType], {
                    position: 'absolute',
                    zIndex: 2,
                    left: 0,
                    top: 0,
                    height: '100%',
                    overflow: 'hidden',
                    width: (waveType == 'progressWave') ? '0' : '100%',
                    boxSizing: 'border-box',
                    pointerEvents: 'none'
                }))
            );
            if (params.classList[waveType]) { this[waveType].classList.add(params.classList[waveType]); }
            if (waveType == 'progressWave') { this[waveType].style.display = 'none'; }
        }, this);
        this.cursor = this.wrapper.appendChild(
            this.style(document.createElement('div'), Object.assign({}, params.styleList.cursor, {
                backgroundColor: params.cursorColor,
                position: 'absolute',
                zIndex: 2,
                width: params.cursorWidth + 'px',
                height: '100%',
                left: 0,
                display: 'none'
            }))
        );
        WaveSurfer.util.refreshAliases (this.aliases, {
            cursorColor: { styleSource: {object: this.cursor.style, property: 'backgroundColor'} },
            cursorWidth: { styleSource: {object: this.cursor.style, property: 'width'} },
        });
        if (params.classList.cursor) { this.cursor.classList.add(params.classList.cursor); }
        this.addCanvas();
    },

    updateSize: function () {
        var totalWidth = Math.round(this.width / this.params.pixelRatio);
        var requiredCanvases = Math.ceil(totalWidth / this.maxCanvasElementWidth);

        while (this.canvases.length < requiredCanvases) { this.addCanvas(); }
        while (this.canvases.length > requiredCanvases) { this.removeCanvas(); }

        this.canvases.forEach (function (canvas, i) {
            // Add some overlap to prevent vertical white stripes; keep the width even for simplicity.
            if (i != this.canvases.length - 1) {
                var canvasWidth = this.maxCanvasWidth + 2 * Math.ceil(this.params.pixelRatio / 2);
            } else {
                var canvasWidth = this.width - (this.maxCanvasWidth * (this.canvases.length - 1));
            }
            this.updateDimensions(canvas, canvasWidth, this.height);
            this.clearWaveType(canvas);
        }, this);
    },

    addCanvas: function () {
        var entry = {};
        var leftOffset = this.maxCanvasElementWidth * this.canvases.length;
        ['progressWave', 'wave'].forEach (function (waveType) {
            entry[waveType] = this[waveType].appendChild(
                this.style(document.createElement('canvas'), {
                    position: 'absolute',
                    left: leftOffset + 'px',
                    top: !this.invertTransparency ? 0 : -(this.halfPixel / 2) + 'px', // Add a small buffer to prevent gaps.
                    height: !this.invertTransparency ? '100%' : 'calc(100% + ' + this.halfPixel + 'px)'
                }));
            entry[waveType + 'Ctx'] = entry[waveType].getContext('2d');
        }, this);
        this.canvases.push(entry);
    },

    removeCanvas: function () {
        var lastEntry = this.canvases.pop();
        lastEntry.wave.parentElement.removeChild(lastEntry.wave);
        if (lastEntry.progressWave) { lastEntry.progressWave.parentElement.removeChild(lastEntry.progressWave); }
    },

    updateDimensions: function (canvas, width, height) {
        var elementWidth = Math.round(width / this.params.pixelRatio);
        var totalWidth   = Math.round(this.width / this.params.pixelRatio);

        // Specify where the canvas starts and ends in the waveform, represented as a decimal between 0 and 1.
        canvas.start = (canvas.waveCtx.canvas.offsetLeft / totalWidth) || 0;
        canvas.end = canvas.start + elementWidth / totalWidth;

        canvas.waveCtx.canvas.width = width;
        canvas.waveCtx.canvas.height = height;

        this.style(this.wave, {height: height / this.params.pixelRatio + 'px'});
        this.style(canvas.waveCtx.canvas, {width: elementWidth + 'px'});
        this.style(this.cursor, {display: 'block'});

        if (!canvas.progressWaveCtx) { return; }
        this.style(this.progressWave, {height: height / this.params.pixelRatio + 'px'});
        canvas.progressWaveCtx.canvas.width  = width;
        canvas.progressWaveCtx.canvas.height = height;
        this.style(canvas.progressWaveCtx.canvas, {width: elementWidth + 'px'});
        this.style(this.progressWave, {display: 'block'});
    },

    clearCanvas: function () {
        this.canvases.forEach (function (canvas) { this.clearWaveType(canvas); }, this);
    },

    clearWaveType: function (canvas) {
        canvas.waveCtx.clearRect(0, 0, canvas.waveCtx.canvas.width, canvas.waveCtx.canvas.height);
        if (!canvas.progressWaveCtx) { return; }
        canvas.progressWaveCtx.clearRect(0, 0, canvas.progressWaveCtx.canvas.width, canvas.progressWaveCtx.canvas.height);
    },

    drawBars: function (peaks, channelIndex, start, end) {
        // Bar wave draws the bottom only as a reflection of the top,
        // so we don't need negative values.
        var hasMinVals = [].some.call(peaks, function (val) {return val < 0;});

        // Skip every other value if there are negatives.
        var peakIndexScale = (hasMinVals) ? 2 : 1;

        // A half-pixel offset makes lines crisp.
        var height = this.params.height * this.params.pixelRatio;
        var offsetY = height * channelIndex || 0;
        var halfH = height / 2;

        var length = peaks.length / peakIndexScale;
        var bar = this.params.barWidth * this.params.pixelRatio;
        var gap = Math.max(this.params.pixelRatio, ~~(bar / 2));
        var step = bar + gap;

        if (!this.params.normalize) {
            var absmax = 1 / this.params.barHeight;
        } else {
            var max = WaveSurfer.util.max(peaks);
            var min = WaveSurfer.util.min(peaks);
            var absmax = -min > max ? -min : max;
        }

        var scale = length / this.width;

        for (var i = (start / scale); i < (end / scale); i += step) {
            var peak = peaks[Math.floor(i * scale * peakIndexScale)] || 0;
            var h = Math.round(peak / absmax * halfH);
            this.fillRect(i + this.halfPixel, halfH - h + offsetY, bar + this.halfPixel, h * 2);
        }

        if (this.params.invertTransparency) { this.invertTransparency(); }
    },

    drawWave: function (peaks, channelIndex, start, end) {
        // Support arrays without negative peaks.
        var hasMinValues = [].some.call(peaks, function (val) { return val < 0; });
        if (!hasMinValues) {
            var reflectedPeaks = [];
            for (var i = 0, len = peaks.length; i < len; i++) {
                reflectedPeaks[2 * i] = peaks[i];
                reflectedPeaks[2 * i + 1] = -peaks[i];
            }
            peaks = reflectedPeaks;
        }

        // A half-pixel offset makes lines crisp.
        var height = this.params.height * this.params.pixelRatio;
        var offsetY = height * channelIndex || 0;
        var halfH = height / 2;

        if (!this.params.normalize) {
            var absmax = 1 / this.params.barHeight;
        } else {
            var max = WaveSurfer.util.max(peaks);
            var min = WaveSurfer.util.min(peaks);
            var absmax = -min > max ? -min : max;
        }

        this.drawLine(peaks, absmax, halfH, offsetY, start, end);

        // Always draw a median line.
        this.fillRect(0, halfH + offsetY - this.halfPixel, this.width, this.halfPixel);

        if (this.params.invertTransparency) { this.invertTransparency(); }
    },

    invertTransparency: function () {
        this.canvases.forEach (function (canvasGroup) {
            ['wave'].concat(canvasGroup.progressWaveCtx ? ['progressWave'] : []).forEach (function (waveType) {
                // Draw the wave canvas onto a new empty canvas.
                var canvas = canvasGroup[waveType];
                var temp = document.createElement('canvas');
                temp.width = canvas.width; temp.height = canvas.height;
                temp.getContext('2d').drawImage (canvas, 0, 0);
                var ctx = canvas.getContext('2d');
                ctx.fillStyle = (waveType == 'wave' || this.params.progressColor === undefined) ? this.params.waveColor : this.params.progressColor;
                // Draw a rectangle onto the wave canvas to fill it with a certain color.
                ctx.globalCompositeOperation = 'copy';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                // Cut out the wave shape from the rectangle and reset globalCompositeOperation.
                ctx.globalCompositeOperation = 'destination-out';
                ctx.drawImage (temp, 0, 0);
                ctx.globalCompositeOperation = 'source-over';
            }, this);
        }, this);
    },

    drawLine: function (peaks, absmax, halfH, offsetY, start, end) {
        this.canvases.forEach (function (canvas) {
            this.setFillStyles(canvas);
            this.drawLineToContext(canvas, canvas.waveCtx, peaks, absmax, halfH, offsetY, start, end);
            this.drawLineToContext(canvas, canvas.progressWaveCtx, peaks, absmax, halfH, offsetY, start, end);
        }, this);
    },

    drawLineToContext: function (canvas, ctx, peaks, absmax, halfH, offsetY, start, end) {
        if (!ctx) { return; }

        var length = peaks.length / 2;

        var scale = 1;
        if (this.params.fillParent && this.width != length) { scale = this.width / length; }

        var first = Math.round(length * canvas.start);
        var last = Math.round(length * canvas.end);
        if (first > end || last < start) { return; }

        var canvasStart = Math.max(first, start);
        var canvasEnd = Math.min(last, end);

        ctx.beginPath();
        ctx.moveTo((canvasStart - first) * scale + this.halfPixel, halfH + offsetY);

        for (var i = canvasStart; i < canvasEnd; i++) {
            var peak = peaks[2 * i] || 0;
            var h = Math.round(peak / absmax * halfH);
            ctx.lineTo((i - first) * scale + this.halfPixel, halfH - h + offsetY);
        }

        // Draw the bottom edge going backwards, to make a single
        // closed hull to fill.
        for (var i = canvasEnd - 1; i >= canvasStart; i--) {
            var peak = peaks[2 * i + 1] || 0;
            var h = Math.round(peak / absmax * halfH);
            ctx.lineTo((i - first) * scale + this.halfPixel, halfH - h + offsetY);
        }

        ctx.closePath();
        ctx.fill();
    },

    fillRect: function (x, y, width, height) {
        var startCanvas = Math.floor(x / this.maxCanvasWidth);
        var endCanvas   = Math.min(Math.ceil((x + width) / this.maxCanvasWidth) + 1, this.canvases.length);

        for (var i = startCanvas; i < endCanvas; i++) {
            var canvas = this.canvases[i];
            var leftOffset = i * this.maxCanvasWidth;

            var intersection = {
                x1: Math.max(x, i * this.maxCanvasWidth),
                y1: y,
                x2: Math.min(x + width, i * this.maxCanvasWidth + canvas.waveCtx.canvas.width),
                y2: y + height
            };

            if (intersection.x1 < intersection.x2) {
                this.setFillStyles(canvas);
                ['wave'].concat(canvas.progressWaveCtx ? ['progressWave'] : []).forEach (function (waveType) {
                    this.fillRectToContext(canvas[waveType + 'Ctx'],
                        intersection.x1 - leftOffset,
                        intersection.y1,
                        intersection.x2 - intersection.x1,
                        intersection.y2 - intersection.y1);
               }, this);
            }
        }
    },

    fillRectToContext: function (ctx, x, y, width, height) {
        if (ctx) { ctx.fillRect(x, y, width, height); }
    },

    setFillStyles: function (canvas) {
        if (this.invertTransparency) { var cutColor = ('cutColor' in this.invertTransparency) ? this.invertTransparency.cutColor : '#fefefe'; }
        canvas.waveCtx.fillStyle = this.invertTransparency ? cutColor : this.params.waveColor;
        if (canvas.progressWaveCtx) { canvas.progressWaveCtx.fillStyle = this.invertTransparency ? cutColor : this.params.progressColor; }
    },

    updateProgress: function (pos) {
        this.style(this.wave, { left: pos + 'px', width: 'calc(100% - ' + pos + 'px)' });
        this.canvases.forEach (function (canvas, i) {
            this.style(canvas.wave, { left: -pos + 'px' });
        }, this);
        var cursorPos = pos - ((this.params.cursorAlignment == 'right') ? 0
            : (this.params.cursorAlignment == 'middle') ? (this.params.cursorWidth / 2)
            : this.params.cursorWidth);
        this.style(this.cursor, { left: cursorPos + 'px' });
        if (this.progressWave) { this.style(this.progressWave, { width: pos + 'px' }); }
    },

    /**
     * Combine all available canvases together.
     *
     * @param {String} type - an optional value of a format type. Default is image/png.
     * @param {Number} quality - an optional value between 0 and 1. Default is 0.92.
     *
     */
    getImage: function (type, quality) {
        var availableCanvas = [];
        this.canvases.forEach(function (canvas) {
            availableCanvas.push(canvas.wave.toDataURL(type, quality));
        });
        return availableCanvas.length > 1 ? availableCanvas : availableCanvas[0];
    }
});

'use strict';

WaveSurfer.Drawer.Canvas = Object.create(WaveSurfer.Drawer.MultiCanvas);

WaveSurfer.util.extend(WaveSurfer.Drawer.Canvas, {
    initDrawer: function (params) {
        this.maxCanvasWidth = this.width = this.getWidth();
        this.maxCanvasElementWidth = Math.round(this.maxCanvasWidth / this.params.pixelRatio);

        if (this.maxCanvasWidth <= 1) {
            throw 'maxCanvasWidth must be greater than 1.';
        } else if (this.maxCanvasWidth % 2 == 1) {
            throw 'maxCanvasWidth must be an even number.';
        }

        this.hasProgressCanvas = this.params.waveColor != this.params.progressColor;
        this.halfPixel = 0.5 / this.params.pixelRatio;
        this.canvases = [];
    },

    updateSize: function () {
        var requiredCanvases = 1;
        while (this.canvases.length < requiredCanvases) { this.addCanvas(); }
        while (this.canvases.length > requiredCanvases) { this.removeCanvas(); }

        this.canvases.forEach (function (canvas, i) {
            // Add some overlap to prevent vertical white stripes; keep the width even for simplicity.
            this.updateDimensions(canvas, this.width, this.height);
            this.clearWaveType(canvas);
        }, this);
    }
});

'use strict';


WaveSurfer.Drawer.None = Object.create(WaveSurfer.Drawer);

WaveSurfer.util.extend(WaveSurfer.Drawer.None, {

    initDrawer: function (params) {
        this.maxCanvasWidth = params.maxCanvasWidth != null ? params.maxCanvasWidth : 4000;
        this.maxCanvasElementWidth = Math.round(this.maxCanvasWidth / this.params.pixelRatio);

        if (this.maxCanvasWidth <= 1) {
            throw 'maxCanvasWidth must be greater than 1.';
        } else if (this.maxCanvasWidth % 2 == 1) {
            throw 'maxCanvasWidth must be an even number.';
        }

        this.hasProgressCanvas = this.params.waveColor != this.params.progressColor;
        this.halfPixel = 0.5 / this.params.pixelRatio;
        this.canvases = [];
    },

    createElements: function () {
     var test = document.createElement ('div')
     return [test]
    },

    updateSize: function () {
    },

    addCanvas: function () {
    },

    removeCanvas: function () {
    },

    updateDimensions: function (canvas, width, height) {
    },

    clearCanvas: function () {
    },

    clearWaveType: function (canvas) {
    },

    drawBars: function (peaks, channelIndex, start, end) {
    },

    drawWave: function (peaks, channelIndex, start, end) {
    },

    drawLine: function (peaks, absmax, halfH, offsetY, start, end) {
    },

    drawLineToContext: function (canvas, ctx, peaks, absmax, halfH, offsetY, start, end) {
    },

    fillRect: function (x, y, width, height) {
    },

    fillRectToContext: function (ctx, x, y, width, height) {
    },

    setFillStyles: function (canvas) {
    },

    updateProgress: function (pos) {
    },

    getImage: function (type, quality) {
    }
});





'use strict';

WaveSurfer.Drawer.SplitWavePointPlot = Object.create(WaveSurfer.Drawer.Canvas);

WaveSurfer.util.extend(WaveSurfer.Drawer.SplitWavePointPlot, {

    defaultPlotParams: {
        plotNormalizeTo: 'whole',
        plotTimeStart: 0,
        plotMin: 0,
        plotMax: 1,
        plotColor     : '#f63',
        plotProgressColor : '#F00',
        plotPointHeight: 2,
        plotPointWidth: 2,
        plotSeparator: true,
        plotSeparatorColor: 'black',
        plotRangeDisplay: false,
        plotRangeUnits: '',
        plotRangePrecision: 4,
        plotRangeIgnoreOutliers: false,
        plotRangeFontSize: 12,
        plotRangeFontType: 'Ariel',
        waveDrawMedianLine: true,
        plotFileDelimiter:  '\t'
    },

    //object variables that get manipulated by various object functions
    plotTimeStart: 0,  //the start time of our wave according to plot data
    plotTimeEnd: -1,   //the end of our wave according to plot data
    plotArrayLoaded: false,
    plotArray: [],     //array of plot data objects containing time and plot value
    plotPoints: [],        //calculated average plot points corresponding to value of our wave
    plotMin: 0,
    plotMax: 1,

    /**
     * Initializes the plot array. If params.plotFileUrl is provided an ajax call will be
     * executed and drawing of the wave is delayed until plot info is retrieved
     * @param params
     */
    initDrawer: function (params) {
        var my = this;
        //set defaults if not passed in
        for(var paramName in this.defaultPlotParams) {
            if(this.params[paramName] === undefined) {
                this.params[paramName] = this.defaultPlotParams[paramName];
            }
        }

        //set the plotTimeStart
        this.plotTimeStart = this.params.plotTimeStart;

        //check to see if plotTimeEnd
        if(this.params.plotTimeEnd !== undefined) {
            this.plotTimeEnd = this.params.plotTimeEnd;
        }

        //set the plot array
        if (Array.isArray(params.plotArray)) {
            this.plotArray = params.plotArray;
            this.plotArrayLoaded = true;
        }
        //Need to load the plot array from ajax with our callback
        else {
            var onPlotArrayLoaded = function (plotArray) {
                my.plotArray = plotArray;
                my.plotArrayLoaded = true;
                my.fireEvent('plot_array_loaded');
            };
            this.loadPlotArrayFromFile(params.plotFileUrl, onPlotArrayLoaded, this.params.plotFileDelimiter);
        }
    },

    /**
     * Draw the peaks - this overrides the drawer.js function and does the following additional steps
     * - ensures that the plotArray has already been loaded, if not it loads via ajax
     * - moves the wave form to where channel 1 would normally be
     * @param peaks
     * @param length
     * @param start
     * @param end
     */
    drawPeaks: function (peaks, length, start, end) {

        //make sure that the plot array is already loaded
        if (this.plotArrayLoaded == true) {
            this.setWidth(length);

            //fake that we are splitting channels
            this.splitChannels = true;
            this.params.height = this.params.height/2;
            if (peaks[0] instanceof Array) {
               peaks = peaks[0];
            }

            this.params.barWidth ?
                this.drawBars(peaks, 1, start, end) :
                this.drawWave(peaks, 1, start, end);

            //set the height back to the original
            this.params.height = this.params.height*2;

            this.calculatePlots();
            this.drawPlots();

        }
        //otherwise wait for the plot array to be loaded and then draw again
        else {
            var my = this;
            my.on('plot-array-loaded', function () {
                my.drawPeaks(peaks, length, start, end);
            });
        }
    },




    /**
     * Loop through the calculated plot values and actually draw them
     */
    drawPlots: function() {
        var height = this.params.height * this.params.pixelRatio / 2;

        var $ = 0.5 / this.params.pixelRatio;

        this.waveCc.fillStyle = this.params.plotColor;
        if(this.progressCc) {
            this.progressCc.fillStyle = this.params.plotProgressColor;
        }
        for(var i in this.plotPoints) {
            var x = parseInt(i);
            var y = height - this.params.plotPointHeight - (this.plotPoints[i] * (height - this.params.plotPointHeight));
            var pointHeight = this.params.plotPointHeight;

            this.waveCc.fillRect(x, y, this.params.plotPointWidth, pointHeight);

            if(this.progressCc) {
                this.progressCc.fillRect(x, y, this.params.plotPointWidth, pointHeight);
            }
        }

        //draw line to separate the two waves
        if(this.params.plotSeparator) {
            this.waveCc.fillStyle = this.params.plotSeparatorColor;
            this.waveCc.fillRect(0, height, this.width, $);
        }

        if(this.params.plotRangeDisplay) {
            this.displayPlotRange();
        }
    },


    /**
     * Display the range for the plot graph
     */
    displayPlotRange: function()
    {
        var fontSize = this.params.plotRangeFontSize * this.params.pixelRatio;
        var maxRange = this.plotMax.toPrecision(this.params.plotRangePrecision) + ' ' + this.params.plotRangeUnits;
        var minRange = this.plotMin.toPrecision(this.params.plotRangePrecision) + ' ' + this.params.plotRangeUnits;
        this.waveCc.font = fontSize.toString() + 'px ' + this.params.plotRangeFontType;
        this.waveCc.fillText(maxRange, 3, fontSize);
        this.waveCc.fillText(minRange, 3, this.height/2);

    },
    /**
     * This function loops through the plotArray and converts it to the plot points
     * to be drawn on the canvas keyed by their position
     */
    calculatePlots: function() {
        //reset plots array
        this.plotPoints = {};

        //make sure we have our plotTimeEnd
        this.calculatePlotTimeEnd();

        var pointsForAverage = [];
        var previousWaveIndex = -1;
        var maxPlot = 0;
        var minPlot = 99999999999999;
        var maxSegmentPlot = 0;
        var minSegmentPlot = 99999999999999;
        var duration = this.plotTimeEnd - this.plotTimeStart;

        //loop through our plotArray and map values to wave indexes and take the average values for each wave index
        for(var i = 0; i < this.plotArray.length; i++) {
            var dataPoint = this.plotArray[i];
            if(dataPoint.value > maxPlot) {maxPlot = dataPoint.value;}
            if(dataPoint.value < minPlot) {minPlot = dataPoint.value;}

            //make sure we are in the specified range
            if(dataPoint.time >= this.plotTimeStart && dataPoint.time <= this.plotTimeEnd) {
                //get the wave index corresponding to the data point
                var waveIndex = Math.round(this.width * (dataPoint.time - this.plotTimeStart) / duration);

                pointsForAverage.push(dataPoint.value);

                //if we have moved on to a new position in our wave record average and reset previousWaveIndex
                if(waveIndex !== previousWaveIndex) {
                    if(pointsForAverage.length > 0) {
                        //get the average plot for this point
                        var avgPlot = this.avg(pointsForAverage);

                        //check for min max
                        if(avgPlot > maxSegmentPlot) {maxSegmentPlot = avgPlot;}
                        if(avgPlot < minSegmentPlot) {minSegmentPlot = avgPlot;}

                        //add plot to the position
                        this.plotPoints[previousWaveIndex] = avgPlot;
                        pointsForAverage = [];
                    }
                }
                previousWaveIndex = waveIndex;
            }
        }

        //normalize the plots points
        if(this.params.plotNormalizeTo == 'whole') {
            this.plotMin = minPlot;
            this.plotMax = maxPlot;
        }
        else if(this.params.plotNormalizeTo == 'values') {
            this.plotMin = this.params.plotMin;
            this.plotMax = this.params.plotMax;
        }
        else {
            this.plotMin = minSegmentPlot;
            this.plotMax = maxSegmentPlot;
        }
        this.normalizeValues();
    },

    /**
     * Function to take all of the plots in this.plots and normalize them from 0 to one
     * depending on this.plotMin and this.plotMax values
     */
    normalizeValues: function() {
        var normalizedValues = {};

        //check to make sure we should be normalizing
        if(this.params.plotNormalizeTo === 'none') {return;}

        for(var i in this.plotPoints) {
            //get the normalized value between 0 and 1
            var normalizedValue = (this.plotPoints[i] - this.plotMin) / (this.plotMax - this.plotMin);

            //check if the value is above our specified range max
            if(normalizedValue > 1) {
                if(!this.params.plotRangeIgnoreOutliers) {
                    normalizedValues[i] = 1;
                }
            }
            //check if hte value is below our specified rant
            else if(normalizedValue < 0) {
                if(!this.params.plotRangeIgnoreOutliers) {
                    normalizedValues[i] = 0;
                }
            }
            //in our range add the normalized value
            else {
                normalizedValues[i] = normalizedValue;
            }
        }
        this.plotPoints = normalizedValues;
    },
    /**
     *
     */

    /**
     * Function to load the plot array from a external file
     *
     * The text file should contain a series of lines.
     * Each line should contain [audio time] [delimiter character] [plot value]
     * e.g. "1.2355 [tab] 124.2321"
     *
     * @param plotFileUrl  url of the file containing time and value information
     * @param onSuccess    function to run on success
     * @param delimiter    the delimiter that separates the time and values on each line
     */
    loadPlotArrayFromFile: function(plotFileUrl, onSuccess, delimiter) {
        //default delimiter to tab character
        if (delimiter === undefined) {delimiter = '\t';}

        var plotArray = [];

        var options = {
            url: plotFileUrl,
            responseType: 'text'
        };
        var fileAjax = WaveSurfer.util.ajax(options);

        fileAjax.on('load', function (data) {
            if (data.currentTarget.status == 200) {
                //split the file by line endings
                var plotLines = data.currentTarget.responseText.split('\n');
                //loop through each line and find the time and plot values (delimited by tab)
                for (var i = 0; i < plotLines.length; i++) {
                    var plotParts = plotLines[i].split(delimiter);
                    if(plotParts.length == 2) {
                        plotArray.push({time: parseFloat(plotParts[0]), value: parseFloat(plotParts[1])});
                    }
                }
                //run success function
                onSuccess(plotArray);
            }
        });
    },

    /***
     * Calculate the end time of the plot
     */
    calculatePlotTimeEnd: function() {
        if(this.params.plotTimeEnd !== undefined) {
            this.plotTimeEnd = this.params.plotTimeEnd;
        }
        else {
            this.plotTimeEnd = this.plotArray[this.plotArray.length -1].time;
        }
    },

    /**
     * Quick convenience function to average numbers in an array
     * @param  array of values
     * @returns {number}
     */
    avg: function(values) {
        var sum = values.reduce(function(a, b) {return a+b;});
        return sum/values.length;
    }
});

WaveSurfer.util.extend(WaveSurfer.Drawer.SplitWavePointPlot, WaveSurfer.Observer);

'use strict';

WaveSurfer.PeakCache = {
    init: function() {
        this.clearPeakCache();
    },

    clearPeakCache: function() {
	// Flat array with entries that are always in pairs to mark the
	// beginning and end of each subrange.  This is a convenience so we can
	// iterate over the pairs for easy set difference operations.
        this.peakCacheRanges = [];
	// Length of the entire cachable region, used for resetting the cache
	// when this changes (zoom events, for instance).
        this.peakCacheLength = -1;
    },

    addRangeToPeakCache: function(length, start, end) {
        if (length != this.peakCacheLength) {
            this.clearPeakCache();
            this.peakCacheLength = length;
        }

        // Return ranges that weren't in the cache before the call.
        var uncachedRanges = [];
        var i = 0;
        // Skip ranges before the current start.
        while (i < this.peakCacheRanges.length && this.peakCacheRanges[i] < start) {
            i++;
        }
	// If |i| is even, |start| falls after an existing range.  Otherwise,
	// |start| falls between an existing range, and the uncached region
	// starts when we encounter the next node in |peakCacheRanges| or
	// |end|, whichever comes first.
        if (i % 2 == 0) {
            uncachedRanges.push(start);
        }
        while (i < this.peakCacheRanges.length && this.peakCacheRanges[i] <= end) {
            uncachedRanges.push(this.peakCacheRanges[i]);
            i++;
        }
        // If |i| is even, |end| is after all existing ranges.
        if (i % 2 == 0) {
            uncachedRanges.push(end);
        }

        // Filter out the 0-length ranges.
        uncachedRanges = uncachedRanges.filter(function(item, pos, arr) {
            if (pos == 0) {
                return item != arr[pos + 1];
            } else if (pos == arr.length - 1) {
                return item != arr[pos - 1];
            } else {
                return item != arr[pos - 1] && item != arr[pos + 1];
            }
        });

	// Merge the two ranges together, uncachedRanges will either contain
	// wholly new points, or duplicates of points in peakCacheRanges.  If
	// duplicates are detected, remove both and extend the range.
        this.peakCacheRanges = this.peakCacheRanges.concat(uncachedRanges);
        this.peakCacheRanges = this.peakCacheRanges.sort(function(a, b) {
            return a - b;
        }).filter(function(item, pos, arr) {
            if (pos == 0) {
                return item != arr[pos + 1];
            } else if (pos == arr.length - 1) {
                return item != arr[pos - 1];
            } else {
                return item != arr[pos - 1] && item != arr[pos + 1];
            }
        });

	// Push the uncached ranges into an array of arrays for ease of
	// iteration in the functions that call this.
        var uncachedRangePairs = [];
        for (i = 0; i < uncachedRanges.length; i += 2) {
            uncachedRangePairs.push([uncachedRanges[i], uncachedRanges[i+1]]);
        }

        return uncachedRangePairs;
    },

    // For testing
    getCacheRanges: function() {
      var peakCacheRangePairs = [];
      for (var i = 0; i < this.peakCacheRanges.length; i += 2) {
          peakCacheRangePairs.push([this.peakCacheRanges[i], this.peakCacheRanges[i+1]]);
      }
      return peakCacheRangePairs;
    }
};

'use strict';

/* Init from HTML */
(function () {
    var init = function () {

        var containers = document.querySelectorAll('wavesurfer');

        Array.prototype.forEach.call(containers, function (el) {
            var params = WaveSurfer.util.extend({
                container: el,
                backend: 'MediaElement',
                mediaControls: true
            }, el.dataset);

            el.style.display = 'block';

            var wavesurfer = WaveSurfer.create(params);

            if (el.dataset.peaks) {
                var peaks = JSON.parse(el.dataset.peaks);
            }
            wavesurfer.load(el.dataset.url, peaks);
        });
    };

    if (document.readyState === 'complete') {
        init();
    } else {
        window.addEventListener('load', init);
    }
}());

return WaveSurfer;

}));
