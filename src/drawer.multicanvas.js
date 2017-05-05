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
        this.progressWave = this.wrapper.appendChild(
            this.style(document.createElement('wave'), {
                position: 'absolute',
                zIndex: 2,
                left: 0,
                top: 0,
                bottom: 0,
                overflow: 'hidden',
                width: '0',
                display: 'none',
                boxSizing: 'border-box',
                borderRightStyle: 'solid',
                borderRightWidth: this.params.cursorWidth + 'px',
                borderRightColor: this.params.cursorColor
            })
        );

        this.addCanvas();
    },

    updateSize: function () {
        var my = this;
        var totalWidth = Math.round(this.width / this.params.pixelRatio),
            requiredCanvases = Math.ceil(totalWidth / this.maxCanvasElementWidth);

        while (this.canvases.length < requiredCanvases) {
            this.addCanvas();
        }

        while (this.canvases.length > requiredCanvases) {
            this.removeCanvas();
        }

        my.canvases.forEach (function (canvas, i) {
            // Add some overlap to prevent vertical white stripes, keep the width even for simplicity.
            var canvasWidth = my.maxCanvasWidth + 2 * Math.ceil(my.params.pixelRatio / 2);

            if (i == my.canvases.length - 1) {
                canvasWidth = my.width - (my.maxCanvasWidth * (my.canvases.length - 1));
            }

            my.updateDimensions(canvas, canvasWidth, my.height);
            my.clearWaveForEntry(canvas);
        });
    },

    addCanvas: function () {
        var canvas = {};
        var leftOffset = this.maxCanvasElementWidth * this.canvases.length;

        canvas.wave = this.wrapper.appendChild(
            this.style(document.createElement('canvas'), {
                position: 'absolute',
                zIndex: 1,
                left: leftOffset + 'px',
                top: 0,
                bottom: 0,
                height: '100%'
            })
        );
        canvas.waveCtx = canvas.wave.getContext('2d');

        if (this.hasProgressCanvas) {
            canvas.progress = this.progressWave.appendChild(
                this.style(document.createElement('canvas'), {
                    position: 'absolute',
                    left: leftOffset + 'px',
                    top: 0,
                    bottom: 0,
                    height: '100%'
                })
            );
            canvas.progressCtx = canvas.progress.getContext('2d');
        }

        this.canvases.push(canvas);
    },

    removeCanvas: function () {
        var lastCanvas = this.canvases.pop();
        lastCanvas.wave.parentElement.removeChild(lastCanvas.wave);
        if (this.hasProgressCanvas) {
            lastCanvas.progress.parentElement.removeChild(lastCanvas.progress);
        }
    },

    updateDimensions: function (canvas, width, height) {
        var elementWidth = Math.round(width / this.params.pixelRatio);
        var totalWidth   = Math.round(this.width / this.params.pixelRatio);

        // Where the canvas starts and ends in the waveform, represented as a decimal between 0 and 1.
        canvas.start = (canvas.waveCtx.canvas.offsetLeft / totalWidth) || 0;
        canvas.end = canvas.start + elementWidth / totalWidth;

        canvas.waveCtx.canvas.width = width;
        canvas.waveCtx.canvas.height = height;
        this.style(canvas.waveCtx.canvas, {width: elementWidth + 'px'});

        this.style(this.progressWave, {display: 'block'});

        if (this.hasProgressCanvas) {
            canvas.progressCtx.canvas.width  = width;
            canvas.progressCtx.canvas.height = height;
            this.style(canvas.progressCtx.canvas, {width: elementWidth + 'px'});
        }
    },

    clearWave: function () {
        var my = this;
        my.canvases.forEach (function (canvas) {my.clearWaveForEntry(canvas);});
    },

    clearWaveForEntry: function (canvas) {
        canvas.waveCtx.clearRect(0, 0, canvas.waveCtx.canvas.width, canvas.waveCtx.canvas.height);
        if (this.hasProgressCanvas) {
            canvas.progressCtx.clearRect(0, 0, canvas.progressCtx.canvas.width, canvas.progressCtx.canvas.height);
        }
    },

    drawBars: function (peaks, channelIndex, start, end) {
        var my = this;
        // Split channels
        if (peaks[0] instanceof Array) {
            var channels = peaks;
            if (this.params.splitChannels) {
                this.setHeight(channels.length * this.params.height * this.params.pixelRatio);
                channels.forEach(function(channelPeaks, i) {
                    my.drawBars(channelPeaks, i, start, end);
                });
                return;
            } else {
                peaks = channels[0];
            }
        }

        // Bar wave draws the bottom only as a reflection of the top,
        // so we don't need negative values
        var hasMinVals = [].some.call(peaks, function (val) {return val < 0;});
        // Skip every other value if there are negatives.
        var peakIndexScale = 1;
        if (hasMinVals) {peakIndexScale = 2;}

        // A half-pixel offset makes lines crisp
        var width = this.width;
        var height = this.params.height * this.params.pixelRatio;
        var offsetY = height * channelIndex || 0;
        var halfH = height / 2;
        var length = peaks.length / peakIndexScale;
        var bar = this.params.barWidth * this.params.pixelRatio;
        var gap = Math.max(this.params.pixelRatio, ~~(bar / 2));
        var step = bar + gap;

        var absmax = 1 / this.params.barHeight;
        if (this.params.normalize) {
            var max = WaveSurfer.util.max(peaks);
            var min = WaveSurfer.util.min(peaks);
            absmax = -min > max ? -min : max;
        }

        var scale = length / width;

        for (var i = (start / scale); i < (end / scale); i += step) {
            var peak = peaks[Math.floor(i * scale * peakIndexScale)] || 0;
            var h = Math.round(peak / absmax * halfH);
            this.fillRect(i + this.halfPixel, halfH - h + offsetY, bar + this.halfPixel, h * 2);
        }
    },

    drawWave: function (peaks, channelIndex, start, end) {
        var my = this;
        // Split channels
        if (peaks[0] instanceof Array) {
            var channels = peaks;
            if (my.params.splitChannels) {
                my.setHeight(channels.length * my.params.height * this.params.pixelRatio);
                channels.forEach(function(channelPeaks, i) {
                    my.drawWave(channelPeaks, i, start, end);
                });
                return;
            } else {
                peaks = channels[0];
            }
        }

        // Support arrays without negative peaks
        var hasMinValues = [].some.call(peaks, function (val) {return val < 0;});
        if (!hasMinValues) {
            var reflectedPeaks = [];
            for (var i = 0, len = peaks.length; i < len; i++) {
                reflectedPeaks[2 * i] = peaks[i];
                reflectedPeaks[2 * i + 1] = -peaks[i];
            }
            peaks = reflectedPeaks;
        }

        // A half-pixel offset makes lines crisp
        var height = this.params.height * this.params.pixelRatio;
        var offsetY = height * channelIndex || 0;
        var halfH = height / 2;

        var absmax = 1 / this.params.barHeight;
        if (my.params.normalize) {
            var max = WaveSurfer.util.max(peaks);
            var min = WaveSurfer.util.min(peaks);
            absmax = -min > max ? -min : max;
        }

        my.drawLine(peaks, absmax, halfH, offsetY, start, end);

        // Always draw a median line
        my.fillRect(0, halfH + offsetY - my.halfPixel, my.width, my.halfPixel);
    },

    drawLine: function (peaks, absmax, halfH, offsetY, start, end) {
        var my = this;
        my.canvases.forEach (function (canvas) {
            my.setFillStyles(canvas);
            my.drawLineToContext(canvas, canvas.waveCtx, peaks, absmax, halfH, offsetY, start, end);
            my.drawLineToContext(canvas, canvas.progressCtx, peaks, absmax, halfH, offsetY, start, end);
        });
    },

    drawLineToContext: function (canvas, ctx, peaks, absmax, halfH, offsetY, start, end) {
        if (!ctx) {return;}

        var length = peaks.length / 2;

        var scale = 1;
        if (this.params.fillParent && this.width != length) {
            scale = this.width / length;
        }

        var first = Math.round(length * canvas.start),
            last = Math.round(length * canvas.end);
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

                this.fillRectToContext(canvas.waveCtx,
                        intersection.x1 - leftOffset,
                        intersection.y1,
                        intersection.x2 - intersection.x1,
                        intersection.y2 - intersection.y1);

                this.fillRectToContext(canvas.progressCtx,
                        intersection.x1 - leftOffset,
                        intersection.y1,
                        intersection.x2 - intersection.x1,
                        intersection.y2 - intersection.y1);
            }
        }
    },

    fillRectToContext: function (ctx, x, y, width, height) {
        if (!ctx) {return;}
        ctx.fillRect(x, y, width, height);
    },

    setFillStyles: function (canvas) {
        canvas.waveCtx.fillStyle = this.params.waveColor;
        if (this.hasProgressCanvas) {
            canvas.progressCtx.fillStyle = this.params.progressColor;
        }
    },

    updateProgress: function (pos) {
        this.style(this.progressWave, { width: pos + 'px' });
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
