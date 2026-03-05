import { EventForm } from '@/components/admin/event-form';

export default function NewEventPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Create Event</h1>
      <EventForm />
    </div>
  );
}
