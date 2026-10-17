import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { SoulMood } from '../types';

interface SoulCoreProps {
  mood: SoulMood;
  intensity: number; // 0 to 1
}

const SoulCore: React.FC<SoulCoreProps> = ({ mood, intensity }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const timeRef = useRef<number>(0);

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    const width = 600;
    const height = 600;

    // Clear previous
    svg.selectAll("*").remove();

    // Definitions for gradients and filters
    const defs = svg.append("defs");

    // Glow Filter
    const filter = defs.append("filter")
      .attr("id", "core-glow")
      .attr("x", "-50%")
      .attr("y", "-50%")
      .attr("width", "200%")
      .attr("height", "200%");

    filter.append("feGaussianBlur")
      .attr("stdDeviation", "15")
      .attr("result", "coloredBlur");

    const feMerge = filter.append("feMerge");
    feMerge.append("feMergeNode").attr("in", "coloredBlur");
    feMerge.append("feMergeNode").attr("in", "SourceGraphic");

    // Color Logic
    let coreColor = "#00f2ff"; // Cyan default
    let secondaryColor = "#050a14";
    
    switch (mood) {
      case SoulMood.PROCESSING:
        coreColor = "#ffd700"; // Gold
        break;
      case SoulMood.CONNECTED:
        coreColor = "#00ff9d"; // Green/Teal
        break;
      case SoulMood.ANALYZING:
        coreColor = "#ff00ff"; // Magenta
        break;
      case SoulMood.HARMONIC:
        coreColor = "#ffffff"; // White
        break;
    }

    // Gradients
    const radialGradient = defs.append("radialGradient")
      .attr("id", "core-gradient")
      .attr("cx", "50%")
      .attr("cy", "50%")
      .attr("r", "50%");

    radialGradient.append("stop")
      .attr("offset", "0%")
      .attr("stop-color", "#ffffff")
      .attr("stop-opacity", 0.9);

    radialGradient.append("stop")
      .attr("offset", "40%")
      .attr("stop-color", coreColor)
      .attr("stop-opacity", 0.6);

    radialGradient.append("stop")
      .attr("offset", "100%")
      .attr("stop-color", secondaryColor)
      .attr("stop-opacity", 0);

    const group = svg.append("g")
      .attr("transform", `translate(${width / 2}, ${height / 2})`);

    // The Organic Blob
    const numPoints = 20;
    const baseRadius = 100;
    const noiseAmplitude = 20 + (intensity * 50);

    const path = group.append("path")
      .attr("fill", "url(#core-gradient)")
      .attr("stroke", coreColor)
      .attr("stroke-width", 2)
      .attr("filter", "url(#core-glow)")
      .style("opacity", 0.8);

    // Outer Rings
    const ringGroup = group.append("g");
    
    const ringData = [140, 180, 240];
    ringGroup.selectAll("circle")
      .data(ringData)
      .enter()
      .append("circle")
      .attr("r", d => d)
      .attr("fill", "none")
      .attr("stroke", coreColor)
      .attr("stroke-width", 1)
      .attr("stroke-opacity", 0.3)
      .attr("stroke-dasharray", "5, 15");

    // Animation Loop
    let animationId: number;

    const animate = () => {
      timeRef.current += 0.01 + (intensity * 0.05);
      
      const points: [number, number][] = [];
      const angleStep = (Math.PI * 2) / numPoints;

      for (let i = 0; i <= numPoints; i++) { // <= to close loop smoothly
        const angle = i * angleStep;
        
        // Simplex-ish noise using sine waves
        const noise = Math.sin(angle * 3 + timeRef.current) * Math.cos(angle * 2 - timeRef.current * 0.5) * Math.sin(timeRef.current * 1.5);
        const r = baseRadius + (noise * noiseAmplitude);

        const x = r * Math.cos(angle);
        const y = r * Math.sin(angle);
        points.push([x, y]);
      }

      // Create a curve generator
      const lineGenerator = d3.line()
        .curve(d3.curveBasisClosed); // Organic curve

      path.attr("d", lineGenerator(points));

      // Rotate rings
      ringGroup.attr("transform", `rotate(${timeRef.current * 10})`);

      animationId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [mood, intensity]);

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
      <svg 
        ref={svgRef} 
        viewBox="0 0 600 600" 
        className="w-full h-full max-w-[800px] max-h-[800px] opacity-90 transition-all duration-1000"
      />
    </div>
  );
};

export default SoulCore;