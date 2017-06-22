'use strict';

var WaveSurfer = {
    defaultParams: {
        audioContext  : null,
        audioRate     : 1,
        autoCenter    : true,
        backend       : 'WebAudio',
        barHeight     : 1,
        classList     : {},
        styleList     : {wave: {}, progressWave: {}, cursor: {}},
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

        // Get defaults. We need this before setting the aliases so that
        // we can refer to the properties when making the custom getters/setters.
        var temp = Object.assign ({}, my.defaultParams);

        // Set aliases.
        var updateCursorPosition = function (n) { if (my.drawer) my.drawer.updateCursorPosition(); };
        var drawBuffer = function () { if (my.drawer) my.drawBuffer(); };

        my.aliases = {};
        my.aliases.cursorColor = {
            target: {object: temp.styleList.cursor, property: '_backgroundColor'},
            sourceList: [
                {object: temp, property: 'cursorColor'},
                {object: temp.styleList.cursor, property: 'backgroundColor'}
            ]
        };
        my.aliases.cursorWidth = {
            target: {object: temp.styleList.cursor, property: '_width'},
            sourceList: [
                {object: temp, property: 'cursorWidth', get: function (n) { return parseFloat(n); }, set: function (n) { return n + 'px'; }, afterSet: updateCursorPosition},
                {object: temp.styleList.cursor, property: 'width', afterSet: updateCursorPosition}
            ]
        };
        my.aliases.cursorAlignment = {
            target: {object: temp.styleList.cursor, property: '_cursorAlignment'},
            sourceList: [{ object: temp, property: 'cursorAlignment', afterSet: updateCursorPosition }]
        };
        ['invertTransparency', 'backgroundColor', 'barWidth'].forEach(function (prop) {
            my.aliases[prop] = {
                target: {object: temp, property: '_' + prop},
                sourceList: [{ object: temp, property: prop, afterSet: drawBuffer }]
            };
        });
        ['wave', 'progressWave'].forEach(function (waveType) {
            ['color', 'backgroundColor'].forEach(function (prop) {
                var uniqueProp = (waveType == 'wave') ? 'wave' : 'progress';
                var propCaps = prop[0].toUpperCase() + prop.slice(1)
                my.aliases[waveType + propCaps] = {
                    target: {object: temp.styleList[waveType], property: '_' + prop},
                    sourceList: [
                        {object: temp, property: uniqueProp + propCaps, afterSet: drawBuffer},
                        {object: temp.styleList[waveType], property: prop, afterSet: drawBuffer}
                    ]
                };
            });
        });
        WaveSurfer.util.refreshAliases(my.aliases);
        
        // Re-assign default parameters to populate the target properties defined in the aliases above.
        var temp = Object.assign (temp, my.defaultParams);

        // Merge defaults and init parameters.
        my.params = WaveSurfer.util.deepMerge(temp, params);

        my.container = (typeof params.container == 'string') ?
            document.querySelector(my.params.container) :
            my.params.container;

        if (!my.container) {
            throw new Error('Container element not found');
        }

        if (my.params.mediaContainer == null) {
            my.mediaContainer = my.container;
        } else if (typeof my.params.mediaContainer == 'string') {
            my.mediaContainer = document.querySelector(my.params.mediaContainer);
        } else {
            my.mediaContainer = my.params.mediaContainer;
        }

        if (!my.mediaContainer) {
            throw new Error('Media Container element not found');
        }

        // Used to save the current volume when muting so we can
        // restore once unmuted
        my.savedVolume = 0;

        // The current muted state
        my.isMuted = false;

        // Will hold a list of event descriptors that need to be
        // cancelled on subsequent loads of audio
        my.tmpEvents = [];

        // Holds any running audio downloads
        my.currentAjax = null;

        my.createDrawer();
        my.createBackend();
        my.createPeakCache();

        my.lastClickPosition = 0;

        my.isDestroyed = false;

        my.on ('ready', function () {
            my.audioIsReady = true;
            if (my.backend.lastClickPosition !== undefined) { my.seekTo(my.backend.lastClickPosition); }
        });
    },

    createDrawer: function () {
        var my = this;
        my.drawer = Object.create(WaveSurfer.Drawer[my.params.renderer]);
        my.drawer.init(my.container, my.params, my.aliases, my);

        my.drawer.on('redraw', function () {
            my.drawBuffer(function () { my.drawer.progress(my.backend.getPlayedPercents()); });
        });

        // Click-to-seek
        my.drawer.on('click', function (e, progress) {
            setTimeout(function () { my.seekTo(progress); }, 0);
        });

        // Relay the scroll event from the drawer
        my.drawer.on('scroll', function (e) {
            if (my.params.partialRender) {
                my.drawBuffer(function () {my.fireEvent('scroll', e); });
            } else {
                my.fireEvent('scroll', e);
            }
        });
    },

    createBackend: function () {
        var my = this;

        if (this.backend) { this.backend.destroy(); }

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
        if (this.audioIsReady || this.cachedData === undefined || this.cachedData.duration === undefined) {
            return this.backend.getDuration();
        } else {
            return this.cachedData.duration;
        }
        return this.backend.getDuration();
    },

    getCurrentTime: function () {
        if (this.audioIsReady || this.cachedData === undefined || this.cachedData.duration === undefined) {
            return this.backend.getCurrentTime();
        } else {
            return this.lastClickPosition * this.cachedData.duration;
        }
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
        this.lastClickPosition = progress;
        this.fireEvent('interaction', this.seekTo.bind(this, progress));

        var paused = this.backend.isPaused();
        // avoid draw wrong position while playing backward seeking
        if (!paused) {
            this.backend.pause();
        }
        // avoid small scrolls while seeking is paused.
        var oldScrollParent = this.params.scrollParent;
        this.params.scrollParent = false;
        this.backend.seekTo(progress * this.getDuration());
        this.drawer.progress(progress);

        if (!paused) { this.backend.play(); }
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

    getNumberOfChannels: function () {
      return this.backend.buffer ? this.backend.buffer.numberOfChannels :
             (this.cachedData && this.cachedData.numberOfChannels !== undefined) ? this.cachedData.numberOfChannels :
            (this.backend.peaks[0] instanceof Array) ? this.backend.peaks.length : 2;
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

    drawBuffer: function (callback) {
        var wse = this.getComputedWidthAndRange();
        var width = wse.width, start = wse.start, end = wse.end;
        var my = this;
        if (my.params.partialRender) {
            var newRanges = my.peakCache.addRangeToPeakCache(width, start, end);
            var peaks = function (inner) {
                for (var i = 0; i < newRanges.length; i++) {
                    var peaks = my.backend.getPeaks(width, newRanges[i][0], newRanges[i][1]);
                    inner(peaks, width, newRanges[i][0], newRanges[i][1]);
                }
            }
        } else {
            if (!('peaks' in my.backend)) {
                var subrangeLength = width;
            } else {
                var numberOfChannels = my.getNumberOfChannels();
                var subrangeLength = ((my.backend.peaks[0] instanceof Array) ? my.backend.peaks[0].length : my.backend.peaks.length) / numberOfChannels;
            }
            start = 0;
            end = subrangeLength - 1;
            var peaks = my.backend.getPeaks(subrangeLength, start, end);
        }
        my.drawer.drawPeaks(peaks, width, start, end, function () {
            if (callback instanceof Function) callback(); my.fireEvent('redraw', peaks, width);
        });
    },

    zoom: function (pxPerSec) {
        this.params.minPxPerSec = pxPerSec;
        this.params.scrollParent = true;
        var my = this;
        this.drawBuffer(function () {
            my.drawer.updateProgress();
            my.drawer.recenter();
            my.fireEvent('zoom', pxPerSec);
        })
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
        var my = this;
        my.backend.load(buffer);
        my.drawBuffer(function () { my.fireEvent('ready'); })
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
    load: function (url, peaks, preload, cachedData) {
        var my = this;
        var cachedData = cachedData || {};
        var loadOnInteraction = cachedData.loadOnInteraction;
        if ('loadOnInteraction' in cachedData) { delete cachedData.loadOnInteraction; }
        my.cachedData = cachedData;
        my.empty({drawPeaks: peaks === undefined}, function () {
            my.isMuted = false;
            switch (my.params.backend) {
                case 'WebAudio': return my.loadBuffer(url, peaks, true, loadOnInteraction);
                case 'MediaElement': return my.loadMediaElement(url, peaks, preload);
            }
        });
    },

    /**
     * Loads audio using Web Audio buffer backend.
     */
    loadBuffer: function (url, peaks, preload, loadOnInteraction) {
        var my = this;
        var load = function (action) {
            if (action) {
                my.tmpEvents.push(my.once('ready', action));
            }
            return my.getArrayBuffer(url, my.loadArrayBuffer.bind(my));
        };

        if (peaks) {
            my.backend.setPeaks(peaks);
            my.drawBuffer(complete);
        } else {
            complete();
        }

        function complete () {
            if (loadOnInteraction) {
                my.tmpEvents.push(my.once('interaction', function (result) { load(result); }));
            } else {
                my.drawer.updateProgress(0);
                return load();
            }
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
                var my = this; my.drawBuffer(function () { my.fireEvent('ready'); });
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
                    var my = this;
                    my.backend.buffer = buffer;
                    my.backend.setPeaks(null);
                    my.drawBuffer(function () { my.fireEvent('waveform-ready'); });
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
    empty: function (init, callback) {
        init = init || {};
        if (!this.backend.isPaused()) {
            this.stop();
            this.backend.disconnectSource();
        }
        this.cancelAjax();
        this.clearTmpEvents();
        this.drawer.progress(0);
        this.drawer.setWidth(0);
        if (!('drawPeaks' in init) || (init.drawPeaks == true)) {
            this.drawer.drawPeaks({ length: this.drawer.getWidth() }, 0, undefined, undefined, callback);
        } else {
            if (callback) callback();
        }
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
