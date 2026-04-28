/**
 * VideoStatusDashboard.jsx
 *
 * Vista de estado de vídeos y sistema de publicación
 * Endpoints: /api/dashboard/video-status, /api/dashboard/next-slot, /api/dashboard/health
 */

import React, { useState, useEffect } from 'react';
import './VideoStatusDashboard.css';

const VideoStatusDashboard = () => {
  const [videoStatus, setVideoStatus] = useState(null);
  const [nextSlot, setNextSlot] = useState(null);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        const [statusRes, slotRes, healthRes] = await Promise.all([
          fetch('/api/dashboard/video-status'),
          fetch('/api/dashboard/next-slot'),
          fetch('/api/dashboard/health'),
        ]);

        if (statusRes.ok) {
          const data = await statusRes.json();
          setVideoStatus(data);
        }

        if (slotRes.ok) {
          const data = await slotRes.json();
          setNextSlot(data);
        }

        if (healthRes.ok) {
          const data = await healthRes.json();
          setHealth(data);
        }
      } catch (err) {
        setError(`Error loading dashboard: ${err.message}`);
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 30000); // Actualizar cada 30s
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return <div className="video-status-dashboard loading">Cargando estado de vídeos...</div>;
  }

  if (error) {
    return <div className="video-status-dashboard error">⚠️ {error}</div>;
  }

  const system = videoStatus?.system || {};
  const summary = videoStatus?.summary || {};
  const videos = videoStatus?.videos || [];

  const statusColor = (status) => {
    switch (status) {
      case 'published': return '#10b981'; // Verde
      case 'ready': return '#10b981';
      case 'queued': return '#f59e0b'; // Amarillo
      case 'rendering': return '#3b82f6'; // Azul
      case 'blocked': return '#ef4444'; // Rojo
      case 'failed': return '#dc2626'; // Rojo oscuro
      default: return '#6b7280'; // Gris
    }
  };

  const getStatusLabel = (status) => {
    const labels = {
      published: '✓ Publicado',
      ready: '✓ Listo',
      queued: '⏳ En cola',
      rendering: '🎬 Renderizando',
      blocked: '⛔ Bloqueado',
      failed: '✗ Fallido',
      unknown: '? Desconocido',
    };
    return labels[status] || status;
  };

  const getCaptionStatusColor = (status) => {
    switch (status) {
      case 'excellent':
        return '#10b981';
      case 'good':
        return '#3b82f6';
      case 'acceptable':
        return '#f59e0b';
      case 'failed':
        return '#ef4444';
      default:
        return '#6b7280';
    }
  };

  return (
    <div className="video-status-dashboard">
      {/* HEADER CON ESTADO DE SISTEMA */}
      <div className="dashboard-header">
        <h1>📊 Estado de Vídeos & Publicación</h1>

        <div className="system-status-cards">
          {/* AUTO_PUBLISH */}
          <div className="status-card auto-publish">
            <div
              className="status-indicator"
              style={{
                backgroundColor: system.autoPublishEnabled ? '#10b981' : '#ef4444',
              }}
            ></div>
            <div className="card-content">
              <div className="card-label">Publicación Automática</div>
              <div className="card-value">
                {system.autoPublishEnabled ? '✓ ACTIVA' : '⛔ PARADA'}
              </div>
              {!system.autoPublishEnabled && (
                <div className="card-hint">Modo manual — re-habilitar después de validación</div>
              )}
            </div>
          </div>

          {/* YOUTUBE OAUTH */}
          <div className="status-card oauth">
            <div
              className="status-indicator"
              style={{
                backgroundColor: system.youtubeOAuthValid ? '#10b981' : '#ef4444',
              }}
            ></div>
            <div className="card-content">
              <div className="card-label">YouTube OAuth</div>
              <div className="card-value">
                {system.youtubeOAuthValid ? '✓ Válido' : '✗ Inválido'}
              </div>
            </div>
          </div>

          {/* PRÓXIMO SLOT */}
          <div className="status-card next-slot">
            <div className="status-indicator" style={{ backgroundColor: '#3b82f6' }}></div>
            <div className="card-content">
              <div className="card-label">Próxima Publicación</div>
              {nextSlot?.minutesUntil !== null ? (
                <>
                  <div className="card-value">{nextSlot.minutesUntil} min</div>
                  <div className="card-hint">
                    {nextSlot.candidateVideoId ? '📹 Hay candidato listo' : '⏳ Esperando vídeo listo'}
                  </div>
                </>
              ) : (
                <div className="card-value">Calculando...</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* CARDS DE RESUMEN */}
      <div className="summary-cards">
        <div className="summary-card published" style={{ borderLeftColor: '#10b981' }}>
          <div className="summary-number">{summary.published || 0}</div>
          <div className="summary-label">Publicados</div>
        </div>
        <div className="summary-card ready" style={{ borderLeftColor: '#10b981' }}>
          <div className="summary-number">{summary.ready || 0}</div>
          <div className="summary-label">Listos</div>
        </div>
        <div className="summary-card queued" style={{ borderLeftColor: '#f59e0b' }}>
          <div className="summary-number">{summary.queued || 0}</div>
          <div className="summary-label">En Cola</div>
        </div>
        <div className="summary-card rendering" style={{ borderLeftColor: '#3b82f6' }}>
          <div className="summary-number">{summary.rendering || 0}</div>
          <div className="summary-label">Renderizando</div>
        </div>
        <div className="summary-card blocked" style={{ borderLeftColor: '#ef4444' }}>
          <div className="summary-number">{summary.blocked || 0}</div>
          <div className="summary-label">Bloqueados</div>
        </div>
        <div className="summary-card failed" style={{ borderLeftColor: '#dc2626' }}>
          <div className="summary-number">{summary.failed || 0}</div>
          <div className="summary-label">Fallidos</div>
        </div>
      </div>

      {/* TABLA DE VÍDEOS */}
      <div className="videos-section">
        <h2>Últimos Vídeos</h2>
        <div className="videos-table-wrapper">
          <table className="videos-table">
            <thead>
              <tr>
                <th>Estado</th>
                <th>Vídeo</th>
                <th>Creado</th>
                <th>Captions</th>
                <th>Assets</th>
                <th>Visual QC</th>
                <th>YouTube</th>
              </tr>
            </thead>
            <tbody>
              {videos.length > 0 ? (
                videos.map((video) => (
                  <tr key={video.videoId} className={`video-row status-${video.status}`}>
                    {/* Estado */}
                    <td className="status-cell">
                      <span
                        className="status-badge"
                        style={{ backgroundColor: statusColor(video.status) }}
                      >
                        {getStatusLabel(video.status)}
                      </span>
                    </td>

                    {/* Vídeo */}
                    <td className="video-cell">
                      <div className="video-info">
                        <div className="video-title" title={video.title}>
                          {video.title.substring(0, 50)}...
                        </div>
                        <div className="video-id">{video.videoId.substring(0, 12)}...</div>
                      </div>
                    </td>

                    {/* Creado */}
                    <td className="created-cell">
                      {video.createdAt ? new Date(video.createdAt).toLocaleDateString('es-ES', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      }) : '—'}
                    </td>

                    {/* Captions */}
                    <td className="captions-cell">
                      <div className="caption-status">
                        <span
                          className="caption-badge"
                          style={{
                            backgroundColor: getCaptionStatusColor(video.captionStatus?.driftStatus),
                          }}
                        >
                          {video.captionStatus?.driftStatus || 'unknown'}
                        </span>
                        {video.captionStatus?.driftSeconds !== null && (
                          <span className="drift-value">
                            {video.captionStatus.driftSeconds.toFixed(2)}s
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Assets */}
                    <td className="assets-cell">
                      <span
                        className="asset-badge"
                        style={{
                          backgroundColor:
                            video.assetStatus?.status === 'pass'
                              ? '#10b981'
                              : video.assetStatus?.status === 'replaced'
                                ? '#f59e0b'
                                : '#ef4444',
                        }}
                      >
                        {video.assetStatus?.status || 'unknown'}
                      </span>
                    </td>

                    {/* Visual QC */}
                    <td className="qc-cell">
                      <span
                        className="qc-badge"
                        style={{
                          backgroundColor:
                            video.visualQc?.status === 'pass'
                              ? '#10b981'
                              : video.visualQc?.status === 'blocked'
                                ? '#ef4444'
                                : '#6b7280',
                        }}
                      >
                        {video.visualQc?.status || 'unknown'}
                      </span>
                    </td>

                    {/* YouTube */}
                    <td className="youtube-cell">
                      {video.youtubeUrl ? (
                        <a href={video.youtubeUrl} target="_blank" rel="noopener noreferrer">
                          📺 Ver
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="7" className="empty-state">
                    No hay vídeos
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* FOOTER */}
      <div className="dashboard-footer">
        <div className="footer-text">
          Última actualización: {new Date().toLocaleTimeString('es-ES')}
        </div>
        <button className="refresh-button" onClick={() => window.location.reload()}>
          🔄 Actualizar
        </button>
      </div>
    </div>
  );
};

export default VideoStatusDashboard;
