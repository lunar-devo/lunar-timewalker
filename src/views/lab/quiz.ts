/**
 * The questions of the lab's class mode. Each sets up an explosion and asks how one body fares; the answer is
 * whatever the lab's model says for that scenario, so the questions and the model cannot drift apart.
 */
import type { L10n, LabCmeStrength, LabExplosionKind } from '../../core/types';
import { LY_AU } from './map';

export interface LabQuestion {
  question: L10n;
  kind: LabExplosionKind;
  cmeStrength: LabCmeStrength;
  /** Where the explosion goes: at a body or star of the map, or this far from Earth (AU) in a free direction. */
  place: { anchorId: string } | { distanceAU: number };
  /** 'earth', or the id of the body the question is about. */
  bodyId: string;
}

export const LAB_QUESTIONS: LabQuestion[] = [
  {
    question: {
      tr: 'Betelgeuse yaklaşık 550 ışık yılı uzakta. Tip II süpernova olarak patlarsa Dünya’ya ne olur?',
      en: 'Betelgeuse is about 550 light years away. If it explodes as a Type II supernova, what happens to Earth?',
    },
    kind: 'sn2',
    cmeStrength: 'may2024',
    place: { anchorId: 'betelgeuse' },
    bodyId: 'earth',
  },
  {
    question: {
      tr: 'Bir Tip II süpernova 20 ışık yılı uzakta patlarsa Dünya’ya ne olur?',
      en: 'A Type II supernova goes off 20 light years away. What happens to Earth?',
    },
    kind: 'sn2',
    cmeStrength: 'may2024',
    place: { distanceAU: 20 * LY_AU },
    bodyId: 'earth',
  },
  {
    question: {
      tr: 'Mayıs 2024’teki kadar güçlü bir Güneş patlamasının bulutu Dünya’ya ulaşırsa ne olur?',
      en: 'The cloud of a solar eruption as strong as that of May 2024 reaches Earth. What happens?',
    },
    kind: 'cme',
    cmeStrength: 'may2024',
    place: { anchorId: 'sun' },
    bodyId: 'earth',
  },
  {
    question: {
      tr: 'Bir Tip II süpernova Jüpiter’in hemen yanında patlarsa Jüpiter’e ne olur?',
      en: 'A Type II supernova goes off right beside Jupiter. What happens to Jupiter?',
    },
    kind: 'sn2',
    cmeStrength: 'may2024',
    place: { anchorId: 'jupiter' },
    bodyId: 'jupiter',
  },
  {
    question: {
      tr: '6.500 ışık yılı uzaktaki bir gama ışını patlamasının hüzmesi Dünya’ya dönükse ne olur?',
      en: 'A gamma-ray burst 6,500 light years away points its beam at Earth. What happens?',
    },
    kind: 'grb',
    cmeStrength: 'may2024',
    place: { distanceAU: 6500 * LY_AU },
    bodyId: 'earth',
  },
];
