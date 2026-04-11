'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { EventForm } from '@/components/admin/event-form';

export default function EditEventPage() {
  const params = useParams();
  const eventId = params.id as string;
  const [event, setEvent] = useState<null | {
    id: string;
    title: string;
    description: string | null;
    streamType: string;
    streamUrl: string | null;
    posterUrl: string | null;
    startsAt: string;
    endsAt: string;
    accessWindowHours: number;
  }>(null);

  useEffect(() => {
    fetch(`/api/admin/events/${eventId}`)
      .then((res) => res.json())
      .then((data) => setEvent(data.data))
      .catch(console.error);
  }, [eventId]);

  if (!event) return <div className="text-gray-400">Loading...</div>;

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Edit Event</h1>
      <EventForm initialData={event} />
    </div>
  );
}
