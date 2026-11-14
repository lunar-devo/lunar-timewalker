import { describe, expect, it } from 'vitest';
import type { LabExplosionKind, WorldId } from '../core/types';
import { archiveTopicAt, type ArchivePlace } from './archive';
import { BODY_TOPICS, INFO_TOPICS, SITES, TRANSIENTS } from './catalog';
import { EVENTS } from './events';
import { GALAXIES } from './galaxies';
import { WORLDS } from './worlds';

const ground: ArchivePlace = { spaceTargetId: null, eventId: null, stagedHere: false, labKind: null, world: 'moon', siteId: null };

describe('The archive topic of a place', () => {
  it('is the subject of the close-up view, whatever event is being watched', () => {
    for (const galaxy of GALAXIES) {
      expect(archiveTopicAt({ ...ground, spaceTargetId: galaxy.id })).toBe(galaxy.topicId);
      // Opened from the ground during the Apollo 11 event, Andromeda still shows Andromeda.
      expect(archiveTopicAt({ ...ground, spaceTargetId: galaxy.id, eventId: 'apollo11', siteId: 'apollo11' })).toBe(galaxy.topicId);
    }
    for (const transient of TRANSIENTS) {
      expect(archiveTopicAt({ ...ground, spaceTargetId: transient.id })).toBe(transient.topicId);
    }
    expect(archiveTopicAt({ ...ground, spaceTargetId: 'mars' })).toBe(BODY_TOPICS.mars);
    expect(archiveTopicAt({ ...ground, spaceTargetId: 'sun' })).toBe(BODY_TOPICS.sun);
    expect(archiveTopicAt({ ...ground, spaceTargetId: 'moon' })).toBe('moon');
  });

  it('is the event’s own topic in the close-up view the event is staged in, and on the ground', () => {
    expect(archiveTopicAt({ ...ground, spaceTargetId: 'mars', eventId: 'dust2018', stagedHere: true })).toBe('mars_dust_2018');
    // The same view opened by hand during another event shows Mars itself.
    expect(archiveTopicAt({ ...ground, spaceTargetId: 'mars', eventId: 'sn1054', stagedHere: false })).toBe(BODY_TOPICS.mars);
    for (const event of EVENTS) {
      expect(archiveTopicAt({ ...ground, eventId: event.id, world: 'mars' })).toBe(event.infoTopicIds[0]);
    }
  });

  it('is the place stood on when no event is on', () => {
    expect(archiveTopicAt({ ...ground, siteId: 'apollo11' })).toBe('apollo11');
    expect(archiveTopicAt({ ...ground, siteId: 'shackleton' })).toBe('shackleton');
    expect(archiveTopicAt({ ...ground, siteId: 'tycho' })).toBe('moon');
    expect(archiveTopicAt({ ...ground, siteId: 'custom' })).toBe('moon');
    expect(archiveTopicAt({ ...ground, world: 'saturn', siteId: 'apollo11' })).toBe('saturn');
  });

  it('is the nearest real thing to the lab’s explosion, in the lab and while it is watched', () => {
    const topics: Record<LabExplosionKind, string> = { sn2: 'sn1054', sn1a: 'sn1572', grb: 'grb', cme: 'solar_storm' };
    for (const kind of Object.keys(topics) as LabExplosionKind[]) {
      expect(archiveTopicAt({ ...ground, labKind: kind })).toBe(topics[kind]);
      expect(archiveTopicAt({ ...ground, labKind: kind, eventId: 'lab_watch', world: 'mars' })).toBe(topics[kind]);
    }
  });

  it('always names a topic the archive has', () => {
    const places: ArchivePlace[] = [
      ...(Object.keys(WORLDS) as WorldId[]).flatMap((world) => SITES.map((site) => ({ ...ground, world, siteId: site.id }))),
      ...[...GALAXIES, ...TRANSIENTS].map((target) => ({ ...ground, spaceTargetId: target.id })),
      ...Object.keys(BODY_TOPICS).map((id) => ({ ...ground, spaceTargetId: id })),
      { ...ground, spaceTargetId: 'moon' },
      { ...ground, spaceTargetId: 'something_new' },
      ...EVENTS.map((event) => ({ ...ground, eventId: event.id })),
    ];
    for (const place of places) expect(INFO_TOPICS).toHaveProperty(archiveTopicAt(place));
  });
});
