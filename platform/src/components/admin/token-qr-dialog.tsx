'use client';

import { useCallback, useRef, useState } from 'react';
import { QRCodeSVG, QRCodeCanvas } from 'qrcode.react';
import { Copy, Check, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

interface TokenQrDialogProps {
  code: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TokenQrDialog({ code, open, onOpenChange }: TokenQrDialogProps) {
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  const watchUrl = code
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/?code=${code}`
    : '';

  const copyUrl = useCallback(() => {
    navigator.clipboard.writeText(watchUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [watchUrl]);

  const downloadPng = useCallback(() => {
    const canvas = canvasRef.current?.querySelector('canvas');
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `ticket-${code}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }, [code]);

  if (!code) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white border-gray-200 text-gray-900 max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-gray-900">Ticket QR Code</DialogTitle>
          <DialogDescription className="text-gray-500">
            Scan this QR code to open the viewer with ticket{' '}
            <code className="font-mono font-semibold text-gray-700">{code}</code>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          {/* Visible SVG QR code */}
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <QRCodeSVG value={watchUrl} size={200} level="H" />
          </div>

          {/* Hidden canvas for PNG download */}
          <div ref={canvasRef} className="hidden">
            <QRCodeCanvas value={watchUrl} size={400} level="H" />
          </div>

          {/* Copyable URL */}
          <button
            onClick={copyUrl}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors max-w-full"
          >
            <span className="truncate font-mono text-xs">{watchUrl}</span>
            {copied ? (
              <Check className="h-3.5 w-3.5 flex-shrink-0 text-green-600" />
            ) : (
              <Copy className="h-3.5 w-3.5 flex-shrink-0" />
            )}
          </button>

          <Button
            variant="outline"
            size="sm"
            onClick={downloadPng}
            className="bg-white border-gray-300 text-gray-900 hover:bg-gray-50"
          >
            <Download className="h-3.5 w-3.5 mr-1" />
            Download PNG
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
