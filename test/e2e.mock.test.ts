import { test, expect } from 'bun:test';
import { ok } from 'neverthrow';
import { httpAdapter } from '../generated/http-adapter';
import { CoursesService } from '../generated/client';

test('e2e mock: client uses httpAdapter and returns ok result', async () => {
  // stub the adapter
  (httpAdapter as any).request = async (url: string, options: any) => {
    return ok({ data: 'stubbed' });
  };

  const res = await CoursesService.coursesFindAll({ params: { limit: 1 } });
  expect(res.isOk()).toBe(true);
});
