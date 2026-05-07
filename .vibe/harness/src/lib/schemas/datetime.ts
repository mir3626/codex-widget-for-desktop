import { z } from 'zod';

export const IsoDateTimeSchema = z.string().datetime({ offset: true });
