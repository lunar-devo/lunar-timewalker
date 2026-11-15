/**
 * The archive topic that belongs to where the user is: the subject of the close-up view that is open, the
 * event being watched, the lab's explosion, or the place stood on. The archive opens on it unless a topic was
 * asked for, so that it never shows the pictures of a page that was left behind.
 */
import type { BodyId, LabExplosionKind, WorldId } from '../core/types';
import { ARTIFACT_PLACEMENTS, BODY_TOPICS, MARS_SITES, SITES, SURFACE_ASSETS, TRANSIENTS } from './catalog';
import { EVENTS } from './events';
import { GALAXIES } from './galaxies';

/** Where the user is, as far as the archive's choice of topic goes. */
export interface ArchivePlace {
  /** The close-up view that is open: a body, a galaxy, a remnant, a comet; null on the ground and in the lab. */
  spaceTargetId: string | null;
  /** The event being watched (null: none), and whether the open close-up view is the one it is staged in. */
  eventId: string | null;
  stagedHere: boolean;
  /** The lab's explosion, in the lab and while it is watched from the ground; null elsewhere. */
  labKind: LabExplosionKind | null;
  world: WorldId;
  siteId: string | null;
}

/** The nearest real thing to each of the lab's explosions: the Crab is what a Type II left, Tycho's remnant a Type Ia. */
const LAB_TOPICS: Record<LabExplosionKind, string> = { sn2: 'sn1054', sn1a: 'sn1572', grb: 'grb', cme: 'solar_storm' };

const WORLD_TOPICS: Record<WorldId, string> = {
  moon: 'moon',
  mercury: 'mercury',
  venus: 'venus',
  earth: 'earth_from_moon',
  mars: 'mars_global',
  jupiter: 'jupiter',
  saturn: 'saturn',
  uranus: 'uranus',
  neptune: 'neptune',
  orbit: 'planets',
};

export function archiveTopicAt(place: ArchivePlace): string {
  if (place.labKind !== null) return LAB_TOPICS[place.labKind];
  const eventTopic = EVENTS.find((e) => e.id === place.eventId)?.infoTopicIds[0];
  const id = place.spaceTargetId;
  if (id !== null) {
    // A close-up view the event is staged in shows the event; any other shows its own subject.
    if (place.stagedHere && eventTopic) return eventTopic;
    if (id === 'moon') return WORLD_TOPICS.moon;
    // The orbit cinematic is about the close approach of 2003, also when opened outside that event.
    if (id === 'mars_orbit') return 'mars_2003';
    if (id in BODY_TOPICS) return BODY_TOPICS[id as BodyId];
    return GALAXIES.find((g) => g.id === id)?.topicId ?? TRANSIENTS.find((t) => t.id === id)?.topicId ?? WORLD_TOPICS.orbit;
  }
  if (eventTopic) return eventTopic;
  if (place.world === 'mars') {
    // On a Mars mission site: the hardware that stands there; elsewhere on Mars, the planet itself.
    const placed = MARS_SITES.some((s) => s.id === place.siteId) ? ARTIFACT_PLACEMENTS.find((p) => p.siteId === place.siteId) : undefined;
    return SURFACE_ASSETS.find((a) => a.id === placed?.assetId)?.topicId ?? WORLD_TOPICS.mars;
  }
  if (place.world !== 'moon') return WORLD_TOPICS[place.world];
  // On the Moon without an event: the place stood on, where the archive has pictures of it.
  if (place.siteId === 'apollo11') return 'apollo11';
  return SITES.find((s) => s.id === place.siteId)?.tags?.includes('pole') ? 'shackleton' : WORLD_TOPICS.moon;
}
