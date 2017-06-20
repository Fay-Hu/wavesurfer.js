'use strict';

WaveSurfer.Drawer.Canvas = Object.create(WaveSurfer.Drawer.MultiCanvas);

WaveSurfer.util.extend(WaveSurfer.Drawer.Canvas, {
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

    updateSize: function () {
        this.maxCanvasWidth = this.width = this.getWidth();
        this.maxCanvasElementWidth = Math.floor(this.maxCanvasWidth / this.params.pixelRatio);
        var requiredCanvases = 1;
        while (this.canvases.length < requiredCanvases) { this.addCanvas(); }
        while (this.canvases.length > requiredCanvases) { this.removeCanvas(); }

        this.canvases.forEach (function (canvas, i) {
            this.updateDimensions(canvas, this.width, this.height);
            this.clearWaveType(canvas);
        }, this);
    }
});
