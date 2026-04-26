const fs = require('fs');
const path = require('path');

const REPORT_PATH = path.resolve(__dirname, '../../../data/integrations/video-matching-report.json');

// Hace matching entre contenido del engine y datos reales.
function matchVideos(contentItems = [], realRecords = []) {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });

  const matched = [];
  const unmatched = [];
  const ambiguousMatches = [];

  contentItems.forEach((item) => {
    const exact = realRecords.find((record) => record.videoId === item.id || record.videoId === item.videoId);
    if (exact) {
      matched.push(_buildMatchedItem(item, exact, 'exact_videoId'));
      return;
    }

    const byTitle = realRecords.filter((record) => _slug(record.title) === _slug(item.title));
    if (byTitle.length === 1) {
      matched.push(_buildMatchedItem(item, byTitle[0], 'title_slug'));
      return;
    }

    if (byTitle.length > 1) {
      ambiguousMatches.push({
        contentId: item.id || item.videoId,
        title: item.title,
        candidates: byTitle.map((candidate) => candidate.videoId)
      });
      return;
    }

    const byTimestamp = realRecords.filter((record) => _isCloseTimestamp(item.publishedAt || item.createdAt, record.publishedAt));
    if (byTimestamp.length === 1) {
      matched.push(_buildMatchedItem(item, byTimestamp[0], 'timestamp_close'));
      return;
    }

    unmatched.push({
      contentId: item.id || item.videoId,
      title: item.title || '',
      topic: item.topic || ''
    });
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    totals: {
      contentItems: contentItems.length,
      realRecords: realRecords.length,
      matched: matched.length,
      unmatched: unmatched.length,
      ambiguousMatches: ambiguousMatches.length
    },
    matched,
    unmatched,
    ambiguousMatches
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

function _buildMatchedItem(content, realRecord, strategy) {
  return {
    contentId: content.id || content.videoId,
    realVideoId: realRecord.videoId,
    strategy,
    title: content.title || realRecord.title,
    topic: content.topic || realRecord.category
  };
}

function _slug(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function _isCloseTimestamp(a, b) {
  if (!a || !b) return false;
  const diff = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return diff <= 1000 * 60 * 30;
}

module.exports = {
  matchVideos,
  REPORT_PATH
};
