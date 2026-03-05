'use client';

import { Settings } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

interface QualityLevel {
  index: number;
  height: number;
  label: string;
}

interface QualitySelectorProps {
  levels: QualityLevel[];
  currentLevel: number;
  autoLevel: boolean;
  onLevelChange: (level: number) => void;
}

export function QualitySelector({
  levels,
  currentLevel,
  autoLevel,
  onLevelChange,
}: QualitySelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (levels.length <= 1) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-center h-10 w-10 rounded-full hover:bg-white/10 transition-colors"
        aria-label="Quality settings"
      >
        <Settings className="h-5 w-5 text-white" />
      </button>
      {isOpen && (
        <div className="absolute bottom-full right-0 mb-2 bg-cinema-black/95 border border-gray-700 rounded-lg p-1 min-w-[120px] shadow-lg">
          <button
            onClick={() => {
              onLevelChange(-1);
              setIsOpen(false);
            }}
            className={`w-full text-left px-3 py-1.5 text-sm rounded ${
              autoLevel ? 'text-accent-blue' : 'text-white hover:bg-white/10'
            }`}
          >
            Auto
          </button>
          {levels.map((level) => (
            <button
              key={level.index}
              onClick={() => {
                onLevelChange(level.index);
                setIsOpen(false);
              }}
              className={`w-full text-left px-3 py-1.5 text-sm rounded ${
                !autoLevel && currentLevel === level.index
                  ? 'text-accent-blue'
                  : 'text-white hover:bg-white/10'
              }`}
            >
              {level.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
