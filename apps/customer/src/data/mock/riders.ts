import type { Rider } from '../types';

export const RIDERS: Rider[] = [
  {
    id: 'rider-ahmed',
    name: 'Ahmed M.',
    photo: 'https://i.pravatar.cc/120?img=68',
    plate: 'Q 1234 ABC',
    vehicle: 'scooter',
    rating: 4.9,
  },
  {
    id: 'rider-mahmoud',
    name: 'Mahmoud K.',
    photo: 'https://i.pravatar.cc/120?img=12',
    plate: 'B 7821 XQ',
    vehicle: 'scooter',
    rating: 4.8,
  },
  {
    id: 'rider-omar',
    name: 'Omar S.',
    photo: 'https://i.pravatar.cc/120?img=15',
    plate: 'C 3344 PL',
    vehicle: 'motorbike',
    rating: 4.7,
  },
  {
    id: 'rider-youssef',
    name: 'Youssef A.',
    photo: 'https://i.pravatar.cc/120?img=51',
    plate: 'A 9008 RR',
    vehicle: 'scooter',
    rating: 4.95,
  },
];

export function pickRandomRider(): Rider {
  return RIDERS[Math.floor(Math.random() * RIDERS.length)];
}
