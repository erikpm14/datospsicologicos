import { useEffect, useState } from 'react';
import axios from 'axios';
import { TrendingUp, BarChart3, Target, Zap, RefreshCw } from 'lucide-react';

const TOPIC_ES = {
  ai_tools: 'Herramientas IA',
  automation: 'Automatización',
  ai_agents: 'Agentes IA',
  auto_channels: 'Canales automáticos',
  productivity: 'Productividad',
  ai_video_editing: 'Edición de vídeo IA',
  content_creation: 'Creación de contenido',
  nocode_lowcode: 'No-code / Low-code',
  tech_experiments: 'Experimentos',
  digital_opportunities: 'Oportunidades digitales',
};

function PerformanceAnalyticsDashboard() {
  const [optimizationStatus, setOptimizationStatus] = useState(null);
  const [optimizationWeights, setOptimizationWeights] = useState(null);
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState(null);

  useEffect(() => {
    async function fetch() {
      try {
        const [statusRes, weightsRes, insightsRes] = await Promise.all([
          axios.get('/api/analytics/optimization-status'),
          axios.get('/api/analytics/optimization-weights'),
          axios.get('/api/analytics/performance'),
        ]);

        setOptimizationStatus(statusRes.data.data);
        setOptimizationWeights(weightsRes.data.data);
        setInsights(insightsRes.data.data.insights);
        setLastFetch(new Date().toLocaleTimeString());
        setLoading(false);
      } catch (err) {
        console.error('Failed to fetch analytics:', err);
        setLoading(false);
      }
    }

    fetch();
    const timer = setInterval(fetch, 30000); // Refresh every 30s
    return () => clearInterval(timer);
  }, []);

  if (loading) {
    return (
      <div className="p-6 bg-slate-900 text-white rounded-lg">
        <div className="flex items-center gap-2">
          <RefreshCw className="animate-spin w-4 h-4" />
          Loading performance analytics...
        </div>
      </div>
    );
  }

  const isActive = optimizationStatus?.status === 'active';

  return (
    <div className="space-y-4 text-white">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-900 to-slate-900 p-6 rounded-lg">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <TrendingUp className="w-6 h-6" />
              ML Performance Analytics
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              {isActive ? '🟢 Active' : '⚫ Inactive'} • {optimizationStatus?.videosAnalyzed || 0} videos
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400">Last updated: {lastFetch}</p>
          </div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Hook Type Distribution */}
        <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
          <h3 className="font-bold mb-4 flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" />
            Hook Type Distribution
          </h3>
          <div className="space-y-3">
            {optimizationWeights?.hookTypeDistribution ? (
              <>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>Challenge</span>
                    <span className="font-mono">{optimizationWeights.hookTypeDistribution.challenge}%</span>
                  </div>
                  <div className="h-2 bg-slate-700 rounded overflow-hidden">
                    <div
                      className="h-full bg-red-500"
                      style={{ width: `${optimizationWeights.hookTypeDistribution.challenge}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>Observable</span>
                    <span className="font-mono">{optimizationWeights.hookTypeDistribution.observable}%</span>
                  </div>
                  <div className="h-2 bg-slate-700 rounded overflow-hidden">
                    <div
                      className="h-full bg-green-500"
                      style={{ width: `${optimizationWeights.hookTypeDistribution.observable}%` }}
                    />
                  </div>
                </div>
              </>
            ) : (
              <p className="text-slate-400">No data yet</p>
            )}
          </div>
          {optimizationWeights?.hookTypeDistribution?.source && (
            <p className="text-xs text-slate-500 mt-3">Source: {optimizationWeights.hookTypeDistribution.source}</p>
          )}
        </div>

        {/* Top Performing Topics */}
        <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
          <h3 className="font-bold mb-4 flex items-center gap-2">
            <Target className="w-4 h-4 text-cyan-400" />
            Top Topics
          </h3>
          <div className="space-y-2">
            {optimizationWeights?.topicPriority && optimizationWeights.topicPriority.length > 0 ? (
              optimizationWeights.topicPriority.slice(0, 5).map((topic, idx) => (
                <div key={topic.topic} className="flex items-center justify-between text-sm">
                  <span>
                    {idx + 1}. {TOPIC_ES[topic.topic] || topic.topic}
                  </span>
                  <span className={`font-mono px-2 py-1 rounded ${
                    topic.priority === 'high' ? 'bg-green-900 text-green-200' :
                    topic.priority === 'medium' ? 'bg-yellow-900 text-yellow-200' :
                    'bg-slate-700 text-slate-300'
                  }`}>
                    {topic.avgVirality}/100
                  </span>
                </div>
              ))
            ) : (
              <p className="text-slate-400">No data yet</p>
            )}
          </div>
        </div>

        {/* Insights Summary */}
        {insights && (
          <>
            <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
              <h3 className="font-bold mb-4 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-blue-400" />
                Performance Summary
              </h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Videos Analyzed</span>
                  <span className="font-mono">{insights.totalVideosAnalyzed}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Avg Duration</span>
                  <span className="font-mono">{insights.durationDistribution?.average.toFixed(1)}s</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Duration Range</span>
                  <span className="font-mono">{insights.durationDistribution?.min}–{insights.durationDistribution?.max}s</span>
                </div>
              </div>
            </div>

            {/* Top Hooks */}
            <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
              <h3 className="font-bold mb-4 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-yellow-400" />
                Top Hooks
              </h3>
              <div className="space-y-2">
                {insights.topHooks && insights.topHooks.length > 0 ? (
                  insights.topHooks.slice(0, 3).map((hook, idx) => (
                    <div key={hook.hook} className="text-sm">
                      <div className="flex justify-between mb-1">
                        <span className="truncate pr-2">{idx + 1}. {hook.hook}</span>
                        <span className="font-mono text-green-400">{hook.avgVirality}/100</span>
                      </div>
                      <div className="text-xs text-slate-400">
                        {hook.count} videos • {hook.hookType}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-slate-400">No data yet</p>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Recommendations */}
      {insights?.recommendations && insights.recommendations.length > 0 && (
        <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
          <h3 className="font-bold mb-4">Recommendations</h3>
          <div className="space-y-3">
            {insights.recommendations.map((rec, idx) => (
              <div key={idx} className="flex gap-3 p-3 bg-slate-700 rounded">
                <div className={`px-3 py-1 rounded text-xs font-bold flex-shrink-0 ${
                  rec.priority === 'high' ? 'bg-red-900 text-red-200' : 'bg-yellow-900 text-yellow-200'
                }`}>
                  {rec.priority.toUpperCase()}
                </div>
                <div className="flex-1 text-sm">
                  <p className="font-medium">{rec.recommendation}</p>
                  <p className="text-slate-400 text-xs mt-1">{rec.reason}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Status Badge */}
      {!isActive && (
        <div className="bg-blue-900 border border-blue-700 p-4 rounded-lg text-sm">
          <p className="text-blue-200">
            <strong>Analytics inactive:</strong> Generate and export 10+ videos to enable ML optimization. Insights will appear here.
          </p>
        </div>
      )}
    </div>
  );
}

export default PerformanceAnalyticsDashboard;
