import { EventList } from '@/components/admin/event-list';

export default function EventsPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Events</h1>
      <EventList />
    </div>
  );
}
