'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface EventFormProps {
  initialData?: {
    id: string;
    title: string;
    description: string | null;
    streamType: string;
    streamUrl: string | null;
    posterUrl: string | null;
    startsAt: string;
    endsAt: string;
    accessWindowHours: number;
    autoPurge: boolean;
    transcoderConfig?: string | null; // JSON string or null (use system defaults)
    playerConfig?: string | null;     // JSON string or null (use system defaults)
  };
}

export function EventForm({ initialData }: EventFormProps) {
  const router = useRouter();
  const isEditing = !!initialData;

  const [formData, setFormData] = useState({
    title: initialData?.title || '',
    description: initialData?.description || '',
    streamType: initialData?.streamType || 'LIVE',
    streamUrl: initialData?.streamUrl || '',
    posterUrl: initialData?.posterUrl || '',
    startsAt: initialData?.startsAt ? new Date(initialData.startsAt).toISOString().slice(0, 16) : '',
    endsAt: initialData?.endsAt ? new Date(initialData.endsAt).toISOString().slice(0, 16) : '',
    accessWindowHours: initialData?.accessWindowHours || 48,
    autoPurge: initialData?.autoPurge ?? true,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const url = isEditing ? `/api/admin/events/${initialData.id}` : '/api/admin/events';
      const method = isEditing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          startsAt: new Date(formData.startsAt).toISOString(),
          endsAt: new Date(formData.endsAt).toISOString(),
          description: formData.description || null,
          streamType: formData.streamType,
          streamUrl: formData.streamUrl || null,
          posterUrl: formData.posterUrl || null,
          autoPurge: formData.autoPurge,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        router.push(`/admin/events/${data.data.id}`);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to save event');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      <div className="space-y-2">
        <Label className="text-gray-700">Title *</Label>
        <Input
          value={formData.title}
          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
          className="bg-white border-gray-300 text-gray-900"
          required
        />
      </div>

      <div className="space-y-2">
        <Label className="text-gray-700">Stream Type *</Label>
        <Select value={formData.streamType} onValueChange={(v) => setFormData({ ...formData, streamType: v })}>
          <SelectTrigger className="w-[180px] bg-white border-gray-300 text-gray-900">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-white border-gray-200 text-gray-900">
            <SelectItem value="LIVE">Live</SelectItem>
            <SelectItem value="VOD">VOD</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {formData.streamType === 'LIVE' && (
        <div className="space-y-2">
          <Label className="text-gray-700">Auto-purge on publish</Label>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="autoPurge"
                checked={formData.autoPurge === true}
                onChange={() => setFormData({ ...formData, autoPurge: true })}
                className="h-4 w-4 border-gray-300 text-accent-blue focus:ring-accent-blue"
              />
              <span className="text-sm text-gray-900">On</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="autoPurge"
                checked={formData.autoPurge === false}
                onChange={() => setFormData({ ...formData, autoPurge: false })}
                className="h-4 w-4 border-gray-300 text-accent-blue focus:ring-accent-blue"
              />
              <span className="text-sm text-gray-900">Off</span>
            </label>
          </div>
          <p className="text-xs text-gray-500">
            When On, existing HLS segments and blobs are deleted before a new RTMP publish starts for this event.
          </p>
        </div>
      )}

      <div className="space-y-2">
        <Label className="text-gray-700">Description</Label>
        <textarea
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent-blue"
          rows={3}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-gray-700">Start Date/Time *</Label>
          <Input
            type="datetime-local"
            value={formData.startsAt}
            onChange={(e) => setFormData({ ...formData, startsAt: e.target.value })}
            className="bg-white border-gray-300 text-gray-900"
            required
          />
        </div>
        <div className="space-y-2">
          <Label className="text-gray-700">End Date/Time *</Label>
          <Input
            type="datetime-local"
            value={formData.endsAt}
            onChange={(e) => setFormData({ ...formData, endsAt: e.target.value })}
            className="bg-white border-gray-300 text-gray-900"
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-gray-700">Access Window (hours after event ends)</Label>
        <Input
          type="number"
          value={formData.accessWindowHours}
          onChange={(e) => setFormData({ ...formData, accessWindowHours: parseInt(e.target.value) || 48 })}
          className="bg-white border-gray-300 text-gray-900 w-32"
          min={1}
          max={168}
        />
        <p className="text-xs text-gray-500">1-168 hours (default: 48)</p>
      </div>

      <div className="space-y-2">
        <Label className="text-gray-700">Stream URL Override (optional)</Label>
        <Input
          value={formData.streamUrl}
          onChange={(e) => setFormData({ ...formData, streamUrl: e.target.value })}
          className="bg-white border-gray-300 text-gray-900"
          placeholder="https://..."
        />
        <p className="text-xs text-gray-500">
          Leave blank for convention-based paths. Only needed for non-standard upstream origins.
        </p>
      </div>

      <div className="space-y-2">
        <Label className="text-gray-700">Poster URL (optional)</Label>
        <Input
          value={formData.posterUrl}
          onChange={(e) => setFormData({ ...formData, posterUrl: e.target.value })}
          className="bg-white border-gray-300 text-gray-900"
          placeholder="https://..."
        />
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex gap-3">
        <Button type="submit" disabled={loading}>
          {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {isEditing ? 'Update Event' : 'Create Event'}
        </Button>
        <Button type="button" variant="outline" className="bg-white border-gray-300 text-gray-900 hover:bg-gray-50" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
