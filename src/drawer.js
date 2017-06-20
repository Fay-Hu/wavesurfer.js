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

        var visibleWidth = this.width;
        var containerWidth = this.getWidth();

        // If the entire container is not filled and further if the nominal width is less than the parent width...
        if (!this.params.fillParent && visibleWidth < containerWidth) {
            var numerator = (clientX - bbox.left) * this.params.pixelRatiol // Apparently we need to scale this here...
            var denominator = visibleWidth - 1;
        } else {
            var numerator = clientX - bbox.left + this.wrapper.scrollLeft;
            var denominator = this.getScrollWidth() - 1;
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

    drawPeaks: WaveSurfer.util.frame(function (peaks, length, start, end, callback) {
        var my = this;

        my.setWidth(length);

        // Clear the canvas.
        my.clearCanvas();

        if (peaks instanceof Function) { peaks(inner); } else { inner(peaks, length, start, end); }
        if (callback) callback();
        
        function inner (peaks, length, start, end) {
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

    recenter: function (proportion) {
        this.recenterOnPosition(proportion * this.getScrollWidth(), 1);
    },

    recenterOnPosition: function (position, scrollSpeed) {
        scrollSpeed = .5;
        var newScroll = position - this.wrapper.clientWidth / 2;
        this.wrapper.scrollLeft = (this.wrapper.scrollLeft * (1 - scrollSpeed) + newScroll * scrollSpeed) || 0;
    },

    getScrollX: function() {
        return Math.round(this.wrapper.scrollLeft * this.params.pixelRatio);
    },

    getWidth: function () {
        return Math.round(this.container.clientWidth * this.params.pixelRatio);
    },

    getScrollWidth: function () {
        return this.wrapper.scrollWidth;
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
        var pos = Math.round(progress * this.width) * minPxDelta;

        if (pos < this.lastPos || pos - this.lastPos >= minPxDelta) {
            this.lastPos = pos
            if (this.params.scrollParent && this.params.autoCenter) {
                var newPos = ~~(this.getScrollWidth() * progress);
                this.recenterOnPosition(newPos, .8);
            }
         }
         this.updateProgress(pos);
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
