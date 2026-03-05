'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, Clock, Users } from 'lucide-react';

interface ErrorMessageProps {
  error: { status: number; message: string; expiresAt?: string } | null;
}

export function ErrorMessage({ error }: ErrorMessageProps) {
  return (
    <AnimatePresence>
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
          className={`flex items-start gap-3 rounded-lg p-4 ${
            error.status === 409
              ? 'bg-status-unused/10 border border-status-unused/30 text-status-unused'
              : 'bg-live-red/10 border border-live-red/30 text-red-300'
          }`}
        >
          {error.status === 409 ? (
            <Users className="h-5 w-5 shrink-0 mt-0.5" />
          ) : error.status === 410 ? (
            <Clock className="h-5 w-5 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          )}
          <p className="text-sm">{error.message}</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
