import bcrypt from 'bcrypt';

export type RoleName = 'ADMIN' | 'TEAM_LEAD' | 'STUDENT' | 'MEMBER' | 'TREASURER' | 'VOLUNTEER';

export type UserRecord = {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  is_active: boolean;
  created_at: string;
};

export type EventRecord = {
  id: number;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  capacity: number;
  status: 'draft' | 'published' | 'cancelled' | 'completed';
  organizer_id: number | null;
  created_at: string;
};

const now = () => new Date().toISOString();

const baseUsers: UserRecord[] = [
  {
    id: 1,
    name: 'Campus Admin',
    email: 'admin@gather.app',
    password_hash: '$2b$12$/Hr9Nunxfco77DBuL92WleAFgzhyyA50YcEZC8dr/GJlC/hu4Xv1G',
    is_active: true,
    created_at: now(),
  },
  {
    id: 2,
    name: 'Student Lead',
    email: 'lead@gather.app',
    password_hash: '$2b$12$n.rOx7UjkUUweSXYH1OWl.B3OG.InFSjpn5NDcI9kLUPXvdcCofnO',
    is_active: true,
    created_at: now(),
  },
];

const roleMap: Record<RoleName, number[]> = {
  ADMIN: [1],
  TEAM_LEAD: [2],
  STUDENT: [1, 2],
  MEMBER: [1, 2],
  TREASURER: [1],
  VOLUNTEER: [2],
};

const baseEvents: EventRecord[] = [
  {
    id: 1,
    title: 'Welcome Week Mixer',
    description: 'Meet student leaders, discover clubs, and connect with the campus community over music and snacks.',
    location: 'Main Quad',
    starts_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 2).toISOString(),
    ends_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 2 + 1000 * 60 * 90).toISOString(),
    capacity: 180,
    status: 'published',
    organizer_id: 2,
    created_at: now(),
  },
  {
    id: 2,
    title: 'Hack Night',
    description: 'A collaborative evening of prototyping, idea sharing, and peer mentorship for students interested in product and tech.',
    location: 'Innovation Lab',
    starts_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 5).toISOString(),
    ends_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 5 + 1000 * 60 * 120).toISOString(),
    capacity: 90,
    status: 'published',
    organizer_id: 2,
    created_at: now(),
  },
  {
    id: 3,
    title: 'Volunteer Drive',
    description: 'Support a community initiative by volunteering for outreach, logistics, and event support during the semester.',
    location: 'Student Center',
    starts_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 9).toISOString(),
    ends_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 9 + 1000 * 60 * 150).toISOString(),
    capacity: 120,
    status: 'published',
    organizer_id: 1,
    created_at: now(),
  },
];

export const fallbackUsers: UserRecord[] = structuredClone(baseUsers);
export const fallbackEvents: EventRecord[] = structuredClone(baseEvents);

export function isDbUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const record = error as { code?: string; message?: string; errno?: number };

  return Boolean(
    !process.env.DB_URL ||
    record.code === 'ECONNREFUSED' ||
    record.code === 'ENOTFOUND' ||
    record.errno === -4078 ||
    (typeof record.message === 'string' && /ECONNREFUSED|ENOTFOUND|connect/i.test(record.message)),
  );
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function getFallbackUserRoles(userId: number): string[] {
  const roles: string[] = [];

  for (const [role, userIds] of Object.entries(roleMap) as unknown as Array<[RoleName, number[]]>) {
    if (userIds.includes(userId)) {
      roles.push(role);
    }
  }

  return roles;
}

export function listFallbackUsers() {
  return fallbackUsers.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    is_active: user.is_active,
    created_at: user.created_at,
    role: getFallbackUserRoles(user.id)[0] ?? 'STUDENT',
  }));
}

export function getFallbackUserByEmail(email: string) {
  return fallbackUsers.find((user) => user.email.toLowerCase() === email.toLowerCase());
}

export function getFallbackUserById(id: number) {
  return fallbackUsers.find((user) => user.id === id);
}

export function createFallbackUser(input: { name: string; email: string; password: string }) {
  const email = input.email.trim().toLowerCase();
  if (fallbackUsers.some((user) => user.email.toLowerCase() === email)) {
    const error = new Error('Duplicate email');
    (error as Error & { code?: string }).code = '23505';
    throw error;
  }

  const user: UserRecord = {
    id: fallbackUsers.length ? Math.max(...fallbackUsers.map((item) => item.id)) + 1 : 1,
    name: input.name.trim(),
    email,
    password_hash: '',
    is_active: true,
    created_at: now(),
  };

  user.password_hash = bcrypt.hashSync(input.password, 12);
  fallbackUsers.push(user);
  roleMap.STUDENT.push(user.id);

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    is_active: user.is_active,
    created_at: user.created_at,
  };
}

export function listFallbackEvents(upcomingOnly = false) {
  const items = fallbackEvents.filter((event) => event.status === 'published');
  const filtered = upcomingOnly
    ? items.filter((event) => new Date(event.starts_at) >= new Date())
    : items;

  return filtered.sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
}

export function getFallbackEventById(id: number) {
  return fallbackEvents.find((event) => event.id === id && event.status === 'published');
}

export function createFallbackEvent(input: {
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  capacity: number;
  organizer_id: number;
}) {
  const event: EventRecord = {
    id: fallbackEvents.length ? Math.max(...fallbackEvents.map((item) => item.id)) + 1 : 1,
    title: input.title,
    description: input.description ?? null,
    location: input.location ?? null,
    starts_at: input.starts_at,
    ends_at: input.ends_at,
    capacity: input.capacity,
    status: 'published',
    organizer_id: input.organizer_id,
    created_at: now(),
  };

  fallbackEvents.push(event);
  return event;
}

type EventPatch = {
  [K in keyof EventRecord]?: EventRecord[K] | undefined;
};

export function updateFallbackEvent(id: number, updates: EventPatch) {
  const index = fallbackEvents.findIndex((event) => event.id === id);
  if (index === -1) {
    return null;
  }

  const merged = {
    ...fallbackEvents[index],
    ...Object.fromEntries(
      Object.entries(updates).filter(([, value]) => value !== undefined),
    ),
  } as EventRecord;

  fallbackEvents[index] = merged;

  return fallbackEvents[index];
}
