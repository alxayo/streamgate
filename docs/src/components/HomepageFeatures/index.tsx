import type {ReactNode} from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  emoji: string;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Token-Gated Access',
    emoji: '🎟️',
    description: (
      <>
        Distribute unique 12-character access codes to your audience.
        Viewers enter their code to instantly start watching — no accounts,
        no registration.
      </>
    ),
  },
  {
    title: 'JWT-Secured Streaming',
    emoji: '🔐',
    description: (
      <>
        Every HLS segment request is validated with a JWT in under 0.01ms.
        Two-layer protection: database validation at entry, cryptographic
        verification on every segment.
      </>
    ),
  },
  {
    title: 'Real-Time Revocation',
    emoji: '⚡',
    description: (
      <>
        Revoke access instantly from the Admin Console. The HLS server's
        in-memory cache syncs every 30 seconds — revoked tokens are blocked
        platform-wide within moments.
      </>
    ),
  },
  {
    title: 'Single-Device Enforcement',
    emoji: '📱',
    description: (
      <>
        One token, one viewer at a time. Session heartbeats and automatic
        release prevent token sharing while keeping the experience seamless
        for legitimate viewers.
      </>
    ),
  },
  {
    title: 'Live & VOD Streaming',
    emoji: '📺',
    description: (
      <>
        Ingest live RTMP streams via FFmpeg, serve pre-recorded HLS content,
        or proxy from upstream origins. Hybrid mode supports all three
        simultaneously.
      </>
    ),
  },
  {
    title: 'Production Ready',
    emoji: '🚀',
    description: (
      <>
        Docker deployment, multi-region edge topology, PostgreSQL support,
        and built-in rate limiting. Scales from a single VPS to global CDN
        edge nodes.
      </>
    ),
  },
];

function Feature({title, emoji, description}: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center" style={{fontSize: '3rem', marginBottom: '0.5rem'}}>
        {emoji}
      </div>
      <div className="text--center padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
