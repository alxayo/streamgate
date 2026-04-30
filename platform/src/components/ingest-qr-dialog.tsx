'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react';
import { Check, Copy, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export type IngestQrKind = 'rtmp' | 'srt';

export interface IngestQrData {
  rtmp: { url: string; server: string; streamKey: string };
  srt: { url: string } | null;
  key: string;
  token: string | null;
}

interface IngestQrDialogProps {
  eventName: string;
  ingest: IngestQrData | null;
  kind: IngestQrKind | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type StreamCasterRtmpPayload = {
  v: 1;
  name: string;
  url: string;
  streamKey: string;
  videoCodec: 'H264';
  isDefault: true;
};

type StreamCasterSrtPayload = {
  v: 1;
  name: string;
  url: string;
  videoCodec: 'H264';
  srtKeyLength: 'AES_128';
  srtLatencyMs: 120;
  srtMode: 'CALLER';
  srtPassphrase?: string;
  srtStreamId?: string;
};

function buildRtmpPayload(eventName: string, ingest: IngestQrData): StreamCasterRtmpPayload {
  const streamKey = ingest.rtmp.streamKey.trim();
  const server = ingest.rtmp.server.replace(/\/$/, '');

  if (streamKey.startsWith('live/')) {
    return {
      v: 1,
      name: eventName,
      url: `${server}/live`,
      streamKey: streamKey.slice('live/'.length),
      videoCodec: 'H264',
      isDefault: true,
    };
  }

  return {
    v: 1,
    name: eventName,
    url: server,
    streamKey,
    videoCodec: 'H264',
    isDefault: true,
  };
}

function buildSrtPayload(eventName: string, ingest: IngestQrData): StreamCasterSrtPayload | null {
  if (!ingest.srt) return null;

  const parsedUrl = new URL(ingest.srt.url);
  const path = parsedUrl.pathname === '/' ? '' : parsedUrl.pathname.replace(/\/$/, '');
  const payload: StreamCasterSrtPayload = {
    v: 1,
    name: eventName,
    url: `${parsedUrl.protocol}//${parsedUrl.host}${path}`,
    videoCodec: 'H264',
    srtKeyLength: 'AES_128',
    srtLatencyMs: 120,
    srtMode: 'CALLER',
  };

  const passphrase = parsedUrl.searchParams.get('passphrase');
  const streamId = parsedUrl.searchParams.get('streamid');

  if (passphrase) payload.srtPassphrase = passphrase;
  if (streamId) payload.srtStreamId = streamId;

  return payload;
}

function buildPayload(eventName: string, ingest: IngestQrData, kind: IngestQrKind): string | null {
  if (kind === 'rtmp') return JSON.stringify(buildRtmpPayload(eventName, ingest));

  const srtPayload = buildSrtPayload(eventName, ingest);
  return srtPayload ? JSON.stringify(srtPayload) : null;
}

export function IngestQrDialog({ eventName, ingest, kind, open, onOpenChange }: IngestQrDialogProps) {
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  const payload = useMemo(() => {
    if (!ingest || !kind) return null;

    try {
      return buildPayload(eventName, ingest, kind);
    } catch {
      return null;
    }
  }, [eventName, ingest, kind]);

  const label = kind === 'srt' ? 'SRT' : 'RTMP';

  const copyPayload = useCallback(() => {
    if (!payload) return;
    navigator.clipboard.writeText(payload);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [payload]);

  const downloadPng = useCallback(() => {
    const canvas = canvasRef.current?.querySelector('canvas');
    if (!canvas) return;
    const link = document.createElement('a');
    const fileSafeName = eventName
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'endpoint';
    link.download = `streamcaster-${label.toLowerCase()}-${fileSafeName}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }, [eventName, label]);

  if (!ingest || !kind) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white border-gray-200 text-gray-900 max-w-md">
        <DialogHeader>
          <DialogTitle className="text-gray-900">{label} StreamCaster QR Code</DialogTitle>
          <DialogDescription className="text-gray-500">
            Scan this QR code to import the {label} ingest endpoint for {eventName}.
          </DialogDescription>
        </DialogHeader>

        {payload ? (
          <div className="flex flex-col items-center gap-4 py-2">
            <div className="bg-white p-4 rounded-lg border border-gray-200">
              <QRCodeSVG value={payload} size={220} level="H" />
            </div>

            <div ref={canvasRef} className="hidden">
              <QRCodeCanvas value={payload} size={480} level="H" />
            </div>

            <button
              onClick={copyPayload}
              className="flex w-full items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-left text-xs text-gray-600 hover:text-gray-900 transition-colors"
              title="Copy StreamCaster JSON"
            >
              <span className="min-w-0 flex-1 truncate font-mono">{payload}</span>
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
        ) : (
          <p className="text-sm text-red-600">Unable to build a StreamCaster payload for this endpoint.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
