import React, { useEffect, useState } from 'react';
import { OrbitNode } from '../types';
import { Activity, Cpu, Radio, Zap } from 'lucide-react';

interface DataOrbitsProps {
  nodes: OrbitNode[];
  /** Accent of the soul these nodes orbit. */
  hue?: string;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}

// Staggered rings, as a percentage of the orbit container.
const RINGS = [24, 31, 38, 44];

const DataOrbits: React.FC<DataOrbitsProps> = ({ nodes, selectedId, onSelect, hue }) => {
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    let frameId: number;
    const animate = () => {
      setRotation(prev => (prev + 0.05) % 360);
      frameId = requestAnimationFrame(animate);
    };
    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, []);

  const getIcon = (type: string) => {
    switch (type) {
      case 'sensor': return <Radio size={16} className="text-reka-cyan" />;
      case 'interface': return <Cpu size={16} className="text-reka-magenta" />;
      case 'data': return <Activity size={16} className="text-reka-gold" />;
      default: return <Zap size={16} />;
    }
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 overflow-hidden">
      <div className="relative w-full h-full max-w-[1000px] max-h-[1000px]">
        {nodes.map((node, index) => {
          const currentAngle = (node.angle + rotation * (node.speed * 10)) * (Math.PI / 180);
          const rPercent = RINGS[index % RINGS.length];
          const xPos = 50 + rPercent * Math.cos(currentAngle);
          const yPos = 50 + rPercent * Math.sin(currentAngle);
          const selected = node.id === selectedId;

          return (
            <div
              key={node.id}
              className="absolute transform -translate-x-1/2 -translate-y-1/2 transition-all duration-75"
              style={{ left: `${xPos}%`, top: `${yPos}%` }}
            >
              <button
                type="button"
                onClick={() => onSelect?.(node.id)}
                aria-pressed={selected}
                aria-label={`${node.label}, ${node.value} tokens today`}
                className="group relative flex flex-col items-center justify-center gap-2 pointer-events-auto cursor-pointer bg-transparent border-0 p-0 focus-visible:outline-none"
              >
                {/* Connector line toward the core */}
                <div
                  className="absolute top-1/2 left-1/2 w-[200px] h-[1px] bg-gradient-to-r from-reka-cyan/0 via-reka-cyan/20 to-transparent -z-10 origin-left"
                  style={{ transform: `rotate(${Math.atan2(50 - yPos, 50 - xPos) * 180 / Math.PI}deg)` }}
                />

                <div
                  style={hue ? { boxShadow: `0 0 12px ${hue}55, inset 0 0 10px ${hue}22`, borderColor: `${hue}66` } : undefined}
                  className={`w-12 h-12 glass-panel rounded-full flex items-center justify-center neon-border group-hover:scale-110 group-focus-visible:scale-110 transition-transform duration-300 bg-reka-dark/80 ${
                    selected ? 'scale-110 ring-2 ring-reka-magenta/70 ring-offset-4 ring-offset-transparent' : ''
                  }`}
                >
                  {getIcon(node.type)}
                </div>

                <div className={`absolute top-14 w-36 text-center transition-opacity ${selected ? 'opacity-100' : 'opacity-70 group-hover:opacity-100'}`}>
                  <p className={`text-[10px] font-mono uppercase tracking-widest truncate ${selected ? 'text-reka-magenta' : 'text-reka-cyan'}`}>{node.label}</p>
                  <p className="text-xs text-white font-bold">{node.value}</p>
                </div>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DataOrbits;
