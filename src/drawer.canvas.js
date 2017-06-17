'use strict';

WaveSurfer.Drawer.Canvas = Object.create(WaveSurfer.Drawer.MultiCanvas);

WaveSurfer.util.extend(WaveSurfer.Drawer.Canvas, {
    initDrawer: function (params) {
        this.maxCanvasElementWidth = Math.round(this.width / this.params.pixelRatio);

        this.hasProgressCanvas = this.params.waveColor != this.params.progressColor;
        this.halfPixel = 0.5 / this.params.pixelRatio;
        this.canvases = [];
    },

    updateSize: function () {
        var totalWidth = Math.round(this.width / this.params.pixelRatio);
        var requiredCanvases = Math.ceil(totalWidth / this.maxCanvasElementWidth);

        while (this.canvases.length < requiredCanvases) { this.addCanvas(); }
        while (this.canvases.length > requiredCanvases) { this.removeCanvas(); }

        this.canvases.forEach (function (canvas, i) {
            // Add some overlap to prevent vertical white stripes; keep the width even for simplicity.
            this.updateDimensions(canvas, this.width, this.height);
            this.clearWaveType(canvas);
        }, this);
    }
});
