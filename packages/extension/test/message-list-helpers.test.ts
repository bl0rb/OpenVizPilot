import { describe, expect, it } from 'vitest';
import {
  INITIAL_LIVE_ANNOUNCEMENT,
  isNearBottom,
  nextLiveAnnouncement,
  STICK_TO_BOTTOM_THRESHOLD_PX,
  toolStepLabel,
} from '../src/ui/MessageList';
import type { ChatItem } from '../src/ui/items';

describe('isNearBottom', () => {
  it('is true when scrolled all the way down', () => {
    expect(isNearBottom({ scrollTop: 560, scrollHeight: 600, clientHeight: 40 })).toBe(true);
  });

  it('is true within the threshold', () => {
    expect(
      isNearBottom({ scrollTop: 600 - 40 - STICK_TO_BOTTOM_THRESHOLD_PX, scrollHeight: 600, clientHeight: 40 }),
    ).toBe(true);
  });

  it('is false once scrolled further up than the threshold', () => {
    expect(
      isNearBottom({ scrollTop: 600 - 40 - STICK_TO_BOTTOM_THRESHOLD_PX - 1, scrollHeight: 600, clientHeight: 40 }),
    ).toBe(false);
  });
});

describe('toolStepLabel', () => {
  it('returns a readable label for known tool names', () => {
    expect(toolStepLabel('list_worksheets')).toBe('Listing worksheets');
    expect(toolStepLabel('get_filters')).toBe('Reading active filters');
    expect(toolStepLabel('tableau_view_data')).toBe('View data read server-side');
  });

  it('falls back to the raw name for unknown tools', () => {
    expect(toolStepLabel('some_future_tool')).toBe('some_future_tool');
  });
});

describe('nextLiveAnnouncement', () => {
  const generating: ChatItem = { kind: 'assistant', id: 1, text: '', streaming: true };
  const stillGenerating: ChatItem = { kind: 'assistant', id: 1, text: 'partial', streaming: true };
  const finished: ChatItem = { kind: 'assistant', id: 1, text: 'partial answer', streaming: false };

  it('announces the start of a new answer', () => {
    const result = nextLiveAnnouncement(INITIAL_LIVE_ANNOUNCEMENT, [generating]);
    expect(result).toEqual({ streamingId: 1, text: 'The answer is being generated.' });
  });

  it('does not re-announce on every streaming token (same id)', () => {
    const afterStart = nextLiveAnnouncement(INITIAL_LIVE_ANNOUNCEMENT, [generating]);
    const afterToken = nextLiveAnnouncement(afterStart, [stillGenerating]);
    expect(afterToken).toBe(afterStart);
  });

  it('announces completion once streaming ends', () => {
    const afterStart = nextLiveAnnouncement(INITIAL_LIVE_ANNOUNCEMENT, [generating]);
    const afterDone = nextLiveAnnouncement(afterStart, [finished]);
    expect(afterDone).toEqual({ streamingId: null, text: 'The answer is ready.' });
  });

  it('leaves the announcement unchanged when there is no assistant message yet', () => {
    const userOnly: ChatItem = { kind: 'user', id: 2, text: 'hi' };
    expect(nextLiveAnnouncement(INITIAL_LIVE_ANNOUNCEMENT, [userOnly])).toBe(INITIAL_LIVE_ANNOUNCEMENT);
  });
});
