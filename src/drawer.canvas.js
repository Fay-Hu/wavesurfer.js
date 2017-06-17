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
