// src/components/auth/PortalLines.jsx
import { useEffect, useRef } from "react";
import styles from "./PortalLines.module.css";

export default function PortalLines() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    let width = 0;
    let height = 0;
    let animationId = 0;
    let frameId = 0;
    let lines = [];

    class Line {
      constructor(origin, size, length, color, style = "pattern") {
        this.size = size;
        this.length = length;
        this.color = color;
        this.style = style;
        this.origin = `M${origin.x},${origin.y}`;
        this.offset = 0;
        this.line = null;
      }

      getColorString() {
        return `hsla(${this.color.h}deg, ${this.color.s}%, ${this.color.l}%, ${this.color.a})`;
      }

      generators() {
        return [
          { line: `h${this.size}`, mag: this.size },
          { line: `h-${this.size}`, mag: this.size },
          { line: `v${this.size}`, mag: this.size },
          { line: `v-${this.size}`, mag: this.size },
          { line: `l${this.size},${this.size}`, mag: Math.hypot(this.size, this.size) },
          { line: `l${this.size},-${this.size}`, mag: Math.hypot(this.size, this.size) },
          { line: `l-${this.size},${this.size}`, mag: Math.hypot(this.size, this.size) },
          { line: `l-${this.size},-${this.size}`, mag: Math.hypot(this.size, this.size) }
        ];
      }

      generate() {
        const segments = this.generators();
        let path = this.origin;
        let mag = 0;

        for (let i = 0; i < this.length; i += 1) {
          const fragment = segments[(Math.random() * segments.length) | 0];
          path += ` ${fragment.line}`;
          mag += fragment.mag;
        }

        this.line = { path, mag };
        return this;
      }

      renderStyle() {
        if (!this.line) return;

        if (this.style === "glitches") {
          ctx.lineDashOffset = this.line.mag + this.offset;
          ctx.setLineDash([
            this.size ** 1.45,
            (this.line.mag / this.length) * this.size ** 1.8
          ]);
          this.offset += 16;
          ctx.lineWidth = 1.2;
          return;
        }

        ctx.lineDashOffset = this.line.mag - this.offset;
        ctx.setLineDash([this.line.mag, this.line.mag]);
        this.offset += 8;
        ctx.lineWidth = 0.35;
      }

      mutatePath() {
        if (!this.line) return;

        const fragments = this.line.path.split(" ").slice(1);
        const generator = this.generators();
        fragments[(Math.random() * fragments.length) | 0] =
          generator[(Math.random() * generator.length) | 0].line;

        this.line.path = `${this.line.path.split(" ")[0]} ${fragments.join(" ")}`;
      }

      draw() {
        if (!this.line) {
          this.generate();
        }

        ctx.strokeStyle = this.getColorString();
        this.renderStyle();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke(new Path2D(this.line.path));
      }
    }

    const clear = () => {
      ctx.fillStyle = "hsla(228deg, 45%, 7%, 0.22)";
      ctx.fillRect(0, 0, width, height);
    };

    const generateLines = (amount) => {
      const presets = [
        { size: 1.2, style: "pattern", color: { h: 210, s: 100, l: 72, a: 0.32 } },
        { size: 2.5, style: "pattern", color: { h: 192, s: 90, l: 55, a: 0.18 } },
        { size: 5, style: "pattern", color: { h: 230, s: 75, l: 62, a: 0.12 } },
        { size: 10, style: "pattern", color: { h: 290, s: 85, l: 58, a: 0.12 } },
        { size: 20, style: "pattern", color: { h: 208, s: 28, l: 38, a: 0.12 } },
        { size: 40, style: "pattern", color: { h: 220, s: 50, l: 58, a: 0.09 } },
        { size: 40, style: "glitches", color: { h: 296, s: 100, l: 58, a: 0.2 } },
        { size: 20, style: "glitches", color: { h: 212, s: 100, l: 56, a: 0.18 } }
      ];

      return Array.from({ length: amount }, () => {
        const preset = presets[(Math.random() ** 2 * presets.length) | 0];

        return new Line(
          { x: width * 0.5, y: height * 0.5 },
          preset.size,
          420 + Math.random() * 800,
          preset.color,
          preset.style
        );
      });
    };

    const render = () => {
      frameId += 1;

      if (frameId % 3 === 0) {
        clear();

        lines.forEach((line) => {
          line.draw();

          if (frameId % 5 === 0 && Math.random() > 0.965) {
            line.mutatePath();
          }
        });
      }

      animationId = requestAnimationFrame(render);
    };

    const resize = () => {
      cancelAnimationFrame(animationId);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
      lines = generateLines(34);
      frameId = 0;
      render();
    };

    resize();
    window.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className={styles.linesCanvas} />;
}