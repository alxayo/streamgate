'use client';

import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AccessEndedProps {
  message: string;
  onBack: () => void;
}

export function AccessEnded({ message, onBack }: AccessEndedProps) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/80">
      <div className="text-center space-y-4 max-w-md px-4">
        <p className="text-xl font-semibold text-white">{message}</p>
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Token Entry
        </Button>
      </div>
    </div>
  );
}
