'use client';

import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

interface PreEventScreenProps {
  title: string;
  description: string | null;
  startsAt: string;
  posterUrl: string | null;
}

export function PreEventScreen({ title, description, startsAt, posterUrl }: PreEventScreenProps) {
  const [countdown, setCountdown] = useState('');

  useEffect(() => {
    const startTime = new Date(startsAt).getTime();

    const update = () => {
      const diff = Math.max(0, startTime - Date.now());
      const hours = Math.floor(diff / 3600000);
      const minutes = Math.floor((diff % 3600000) / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);

      if (hours > 0) {
        setCountdown(`${hours}h ${minutes}m ${seconds}s`);
      } else if (minutes > 0) {
        setCountdown(`${minutes}m ${seconds}s`);
      } else {
        setCountdown(`${seconds}s`);
      }
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [startsAt]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-6 p-8">
      {posterUrl && (
        <img
          src={posterUrl}
          alt={title}
          className="max-w-sm w-full rounded-lg shadow-lg opacity-90"
        />
      )}
      <h2 className="text-3xl font-semibold text-white">{title}</h2>
      {description && <p className="text-gray-400 max-w-md">{description}</p>}
      <div className="flex items-center gap-2 text-accent-blue">
        <Clock className="h-5 w-5" />
        <span className="text-lg font-mono">Starts in {countdown}</span>
      </div>
      <p className="text-sm text-gray-500">
        The stream will start automatically when the event begins
      </p>
    </div>
  );
}
