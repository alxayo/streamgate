'use client';

import { Play, Pause } from 'lucide-react';
import { motion } from 'framer-motion';

interface PlayPauseButtonProps {
  isPlaying: boolean;
  onClick: () => void;
}

export function PlayPauseButton({ isPlaying, onClick }: PlayPauseButtonProps) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center h-10 w-10 rounded-full hover:bg-white/10 transition-colors"
      aria-label={isPlaying ? 'Pause' : 'Play'}
    >
      <motion.div
        key={isPlaying ? 'pause' : 'play'}
        initial={{ scale: 0.8, rotate: -90 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ duration: 0.1 }}
      >
        {isPlaying ? (
          <Pause className="h-5 w-5 text-white fill-white" />
        ) : (
          <Play className="h-5 w-5 text-white fill-white" />
        )}
      </motion.div>
    </button>
  );
}
