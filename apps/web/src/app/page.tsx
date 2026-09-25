'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Server, HardDrive, ShieldCheck, Activity, AlertTriangle,
  RefreshCw, Upload, Download, Trash2, Cpu, FileText,
  CheckCircle2, XCircle, Zap, Eye, X, Flame, ShieldAlert, Wrench, Sparkles,
  Database, TrendingUp, Clock, Lock, ChevronRight
} from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

/* ─── tiny helpers ─────────────────────────────────────────── */
function formatBytes(bytes: number) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function timeAgo(date: string | Date) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

/* ─── sub-components ───────────────────────────────────────── */

function StatusDot({ healthy }: { healthy: boolean }) {
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${healthy ? 'bg-green-400' : 'bg-red-400'}`} />
      <span className={`relative inline-flex rounded-full h-2 w-2 ${healthy ? 'bg-green-500' : 'bg-red-500'}`} />
    </span>
  );
}

function Badge({ variant, children }: { variant: 'green' | 'red' | 'amber' | 'neutral'; children: React.ReactNode }) {
  const cls: Record<string, string> = {
    green: 'bg-green-500/10 border-green-500/20 text-green-400',
    red:   'bg-red-500/10   border-red-500/20   text-red-400',
    amber: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
    neutral:'bg-[#091126]/5     border-[#1E2D5A]      text-zinc-400',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-semibold tracking-wide uppercase ${cls[variant]}`}>
      {children}
    </span>
  );
}

function MetricCard({
  label, value, sub, icon: Icon, accent = 'neutral', bar
}: {
  label: string; value: React.ReactNode; sub?: React.ReactNode;
  icon: any; accent?: 'green' | 'amber' | 'red' | 'neutral'; bar?: number;
}) {
  const iconColors: Record<string, string> = {
    green: 'text-green-400', amber: 'text-amber-400',
    red: 'text-red-400', neutral: 'text-zinc-400',
  };
  const barColors: Record<string, string> = {
    green: 'bg-green-500', amber: 'bg-amber-500',
    red: 'bg-red-500', neutral: 'bg-zinc-500',
  };
  return (
    <div
      className="group relative bg-[#091126] border border-[#1E2D5A] rounded-xl p-5 hover:border-[#2a4080] hover:bg-[#0d1835] transition-all duration-200 cursor-default"
      style={{ animation: 'fadeUp 0.3s ease forwards' }}
    >
      <div className="flex items-start justify-between mb-4">
        <span className="text-xs font-medium text-zinc-400 tracking-wide uppercase">{label}</span>
        <div className={`p-1.5 rounded-lg bg-blue-500/[0.12] ${iconColors[accent]}`}>
          <Icon className="w-3.5 h-3.5" />
        </div>
      </div>
      <div className="text-2xl font-bold text-zinc-100 tracking-tight mb-1">{value}</div>
      {sub && <div className="text-xs text-zinc-200 mt-1">{sub}</div>}
      {typeof bar === 'number' && (
        <div className="mt-3 h-[2px] bg-[#1E2D5A] rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-700 ${barColors[accent]}`} style={{ width: `${Math.min(bar, 100)}%` }} />
        </div>
      )}
    </div>
  );
}

function NodeCard({
  node,
  onKill,
  onRecover,
  onInspect,
}: {
  node: any;
  onKill: (id: string) => void;
  onRecover: (id: string) => void;
  onInspect: (id: string) => void;
}) {
  const isFailed = node.status === 'FAILED';
  const isDegraded = node.status === 'DEGRADED';

  const usagePercent = node.totalCapacity
    ? Math.min(((node.usedStorage || 0) / node.totalCapacity) * 100, 100)
    : 0;

  return (
    <div
      className={`relative bg-vault-card border rounded-xl p-4 flex flex-col gap-4 transition-all duration-200 hover:bg-[#091126] ${
        isFailed
          ? 'border-red-500/30 bg-red-500/[0.03]'
          : isDegraded
          ? 'border-amber-500/25'
          : 'border-[#1E2D5A] hover:border-[#2a4080]'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div className={`p-1.5 rounded-lg ${isFailed ? 'bg-red-500/10' : isDegraded ? 'bg-amber-500/10' : 'bg-vault-bg'}`}>
            <Server className={`w-3.5 h-3.5 ${isFailed ? 'text-red-400' : isDegraded ? 'text-amber-400' : 'text-zinc-400'}`} />
          </div>
          <div>
            <div className="text-sm font-semibold text-zinc-100">{node.name}</div>
            <div className="text-[10px] text-zinc-400 font-mono mt-0.5">{node.address}</div>
          </div>
        </div>
        <Badge variant={isFailed ? 'red' : isDegraded ? 'amber' : 'green'}>
          {node.status}
        </Badge>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-[#091126] border border-[#1E2D5A] rounded-lg p-2.5">
          <div className="text-[10px] text-zinc-400 mb-1">Replicas</div>
          <div className="text-sm font-bold text-zinc-100 font-mono">{node.replicaCount ?? 0}</div>
        </div>
        <div className="bg-[#091126] border border-[#1E2D5A] rounded-lg p-2.5">
          <div className="text-[10px] text-zinc-400 mb-1">Risk Score</div>
          <div className={`text-sm font-bold font-mono ${(node.riskScore || 0) > 0.5 ? 'text-red-400' : 'text-green-400'}`}>
            {node.riskScore ?? 0}
          </div>
        </div>
      </div>

      {/* Storage bar */}
      <div>
        <div className="flex justify-between items-center mb-1.5">
          <span className="text-[10px] text-zinc-400">Storage Used</span>
          <span className="text-[10px] font-mono text-zinc-400">{formatBytes(node.usedStorage || 0)}</span>
        </div>
        <div className="h-[3px] bg-[#1E2D5A] rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${usagePercent > 80 ? 'bg-red-500' : usagePercent > 50 ? 'bg-amber-500' : 'bg-green-500'}`}
            style={{ width: `${usagePercent}%` }}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 border-t border-[#1E2D5A]">
        <button
          onClick={() => onInspect(node.id)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-zinc-400 hover:text-zinc-100 bg-[#091126] hover:bg-[#1a2f60] border border-[#1E2D5A] rounded-lg transition"
        >
          <Eye className="w-3 h-3" />
          Inspect
        </button>

        {isFailed ? (
          <button
            onClick={() => onRecover(node.id)}
            className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-green-400 hover:text-green-300 bg-green-500/10 hover:bg-green-500/15 border border-green-500/20 rounded-lg transition"
          >
            <RefreshCw className="w-3 h-3" />
            Recover
          </button>
        ) : (
          <button
            onClick={() => onKill(node.id)}
            className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/15 border border-red-500/20 rounded-lg transition"
          >
            <AlertTriangle className="w-3 h-3" />
            Kill Node
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── MAIN COMPONENT ───────────────────────────────────────── */

export default function Dashboard() {
  const [nodes, setNodes] = useState<any[]>([]);
  const [objects, setObjects] = useState<any[]>([]);
  const [repairs, setRepairs] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'info' | 'success' | 'error' } | null>(null);
  const [selectedNodeDetail, setSelectedNodeDetail] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState<'objects' | 'repairs'>('objects');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((msg: string, type: 'info' | 'success' | 'error' = 'info') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const [nodesRes, objectsRes, repairsRes, metricsRes] = await Promise.all([
        fetch(`${API_BASE}/nodes`).then(r => r.json()),
        fetch(`${API_BASE}/objects`).then(r => r.json()),
        fetch(`${API_BASE}/repairs`).then(r => r.json()),
        fetch(`${API_BASE}/metrics`).then(r => r.json()),
      ]);
      setNodes(Array.isArray(nodesRes) ? nodesRes : []);
      setObjects(Array.isArray(objectsRes) ? objectsRes : []);
      setRepairs(Array.isArray(repairsRes) ? repairsRes : []);
      setMetrics(metricsRes || null);
    } catch (err) {
      console.error('Error fetching cluster data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 2000);
    return () => clearInterval(interval);
  }, [fetchData]);

  /* Actions */
  const handleKillNode = async (nodeId: string) => {
    showToast(`Simulating failure for node ${nodeId}…`, 'info');
    try {
      const res = await fetch(`${API_BASE}/admin/nodes/${nodeId}/fail`, { method: 'POST' });
      const data = await res.json();
      showToast(`Node killed. Triggered ${data.repairedJobs} repair jobs.`, 'success');
      fetchData();
    } catch (err: any) {
      showToast(`Kill failed: ${err.message}`, 'error');
    }
  };

  const handleRecoverNode = async (nodeId: string) => {
    showToast('Recovering node…', 'info');
    try {
      await fetch(`${API_BASE}/admin/nodes/${nodeId}/recover`, { method: 'POST' });
      showToast('Node recovered to HEALTHY state.', 'success');
      fetchData();
    } catch (err: any) {
      showToast(`Recovery failed: ${err.message}`, 'error');
    }
  };

  const handleInspectNode = async (nodeId: string) => {
    try {
      const res = await fetch(`${API_BASE}/nodes/${nodeId}`);
      if (res.ok) setSelectedNodeDetail(await res.json());
    } catch (err) {
      console.error('Error fetching node detail:', err);
    }
  };

  const handleCorruptReplica = async (replicaId: string) => {
    showToast('Simulating bit-rot corruption…', 'info');
    try {
      const res = await fetch(`${API_BASE}/admin/replicas/${replicaId}/corrupt`, { method: 'POST' });
      const data = await res.json();
      showToast(`Replica corrupted. Auto-healed: ${data.repaired}`, 'success');
      fetchData();
    } catch (err: any) {
      showToast(`Corrupt trigger failed: ${err.message}`, 'error');
    }
  };

  const handleVerifyObject = async (objectId: string) => {
    showToast('Running SHA-256 integrity audit…', 'info');
    try {
      const res = await fetch(`${API_BASE}/objects/${objectId}/verify`, { method: 'POST' });
      const data = await res.json();
      if (data.verified) showToast('All SHA-256 checksums verified ✓', 'success');
      else showToast(`Corruption detected! Mismatches: ${data.corruptedCount}. Repaired: ${data.repaired}`, 'error');
      fetchData();
    } catch (err: any) {
      showToast(`Verification failed: ${err.message}`, 'error');
    }
  };

  const handleDeleteObject = async (objectId: string) => {
    if (!confirm('Delete this object from all storage nodes?')) return;
    try {
      await fetch(`${API_BASE}/objects/${objectId}`, { method: 'DELETE' });
      fetchData();
    } catch (err) { console.error(err); }
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    showToast('Hashing & running Risk-Aware Placement Engine…', 'info');
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(`${API_BASE}/objects`, { method: 'POST', body: formData });
      if (res.ok) {
        const data = await res.json();
        showToast(`Uploaded ${data.object.filename} to ${data.placementNodes.length} nodes.`, 'success');
        fetchData();
      } else {
        const err = await res.json();
        showToast(`Upload failed: ${err.message || err.error}`, 'error');
      }
    } catch (err: any) {
      showToast(`Upload error: ${err.message}`, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleSimulateOutage = async () => {
    const healthy = nodes.filter(n => n.status === 'HEALTHY');
    if (healthy.length === 0) { showToast('No healthy nodes to kill.', 'error'); return; }
    const toKill = healthy.slice(0, 2);
    showToast(`Simulating multi-node outage on ${toKill.map(n => n.name).join(', ')}…`, 'info');
    for (const node of toKill) {
      await fetch(`${API_BASE}/admin/nodes/${node.id}/fail`, { method: 'POST' });
    }
    fetchData();
  };

  const handleSimulateBitRot = async () => {
    if (objects.length === 0) { showToast('Upload a file first.', 'error'); return; }
    const rep = objects[0]?.replicas?.[0];
    if (rep) handleCorruptReplica(rep.id);
  };

  const handleHealAllNodes = async () => {
    showToast('Restoring all failed nodes to HEALTHY…', 'info');
    for (const node of nodes) {
      if (node.status === 'FAILED') {
        await fetch(`${API_BASE}/admin/nodes/${node.id}/recover`, { method: 'POST' });
      }
    }
    fetchData();
  };

  const handleDeprovisionExcess = async () => {
    showToast('Removing idle excess auto-provisioned nodes…', 'info');
    try {
      const res = await fetch(`${API_BASE}/admin/nodes/deprovision-excess`, { method: 'POST' });
      const data = await res.json();
      showToast(data.message, data.deprovisioned > 0 ? 'success' : 'info');
      fetchData();
    } catch (err: any) {
      showToast(`Cleanup error: ${err.message}`, 'error');
    }
  };

  const handleProvisionNode = async () => {
    showToast('Auto-provisioning new storage microservice…', 'info');
    try {
      const res = await fetch(`${API_BASE}/admin/nodes/provision`, { method: 'POST' });
      const data = await res.json();
      if (data.provisioned) showToast(`Provisioned ${data.node.name} on ${data.node.address}`, 'success');
      else showToast(data.message || 'Enough healthy nodes already.', 'info');
      fetchData();
    } catch (err: any) {
      showToast(`Provision error: ${err.message}`, 'error');
    }
  };

  const clusterHealthy = (metrics?.failedNodes ?? 0) === 0;
  const totalNodes = metrics?.totalNodes ?? 0;
  const healthyNodes = metrics?.healthyNodes ?? 0;
  const storagePercent = metrics?.totalCapacity
    ? Math.min(((metrics?.usedStorage || 0) / metrics.totalCapacity) * 100, 100)
    : 0;

  /* Toast colors */
  const toastCls = toast
    ? toast.type === 'success'
      ? 'border-green-500/30 bg-green-500/10 text-green-300'
      : toast.type === 'error'
      ? 'border-red-500/30 bg-red-500/10 text-red-300'
      : 'border-[#2a4080] bg-[#161616] text-zinc-200'
    : '';

  return (
    <div className="min-h-screen bg-vault-bg text-slate-200">
      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); }}
        disabled={uploading}
        className="hidden"
      />

      {/* ─── TOPBAR ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-vault-bg/90 backdrop-blur-xl border-b border-[#1E2D5A]">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-[#1a1a1a] border border-[#1E2D5A] flex items-center justify-center">
              <Database className="w-3.5 h-3.5 text-zinc-200" />
            </div>
            <div>
              <span className="text-sm font-bold text-zinc-100 tracking-widest">VAULT</span>
              <span className="hidden sm:inline text-xs text-zinc-400 ml-2 font-mono">v2.0</span>
            </div>
          </div>

          {/* Status + controls */}
          <div className="flex items-center gap-3">
            {/* Toast notification */}
            {toast && (
              <div className={`slide-in flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs max-w-sm ${toastCls}`}>
                <Activity className="w-3.5 h-3.5 shrink-0" />
                <span className="line-clamp-1">{toast.msg}</span>
              </div>
            )}

            {/* Cluster health badge */}
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-vault-card border border-[#1E2D5A] text-xs">
              <StatusDot healthy={clusterHealthy} />
              <span className="text-zinc-400 font-medium">
                {clusterHealthy ? 'Healthy' : 'Self-Healing'}
              </span>
            </div>

            <button
              onClick={fetchData}
              className="p-1.5 rounded-lg bg-vault-card border border-[#1E2D5A] text-zinc-400 hover:text-zinc-100 hover:bg-[#1a2f60] transition"
              title="Refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8">

        {/* ─── HERO METRICS ───────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
          <MetricCard
            label="Node Availability"
            value={`${healthyNodes} / ${totalNodes}`}
            sub={metrics?.failedNodes > 0 ? `${metrics.failedNodes} node${metrics.failedNodes > 1 ? 's' : ''} failed` : 'All operational'}
            icon={Server}
            accent={metrics?.failedNodes > 0 ? 'red' : 'green'}
          />
          <MetricCard
            label="Stored Objects"
            value={metrics?.totalObjects ?? 0}
            sub={`${metrics?.totalReplicas ?? 0} total replicas`}
            icon={HardDrive}
            accent="neutral"
          />
          <MetricCard
            label="Storage Used"
            value={formatBytes(metrics?.usedStorage ?? 0)}
            sub={`${storagePercent.toFixed(1)}% utilization`}
            icon={Cpu}
            accent={storagePercent > 80 ? 'red' : storagePercent > 50 ? 'amber' : 'green'}
            bar={storagePercent}
          />
          <MetricCard
            label="Avg Recovery"
            value={`${metrics?.avgRecoveryTimeSec ?? 0}s`}
            sub={`${metrics?.completedRepairJobs ?? 0} jobs done`}
            icon={Clock}
            accent="amber"
          />
        </div>

        {/* ─── CHAOS CONTROL ──────────────────────────────── */}
        <section className="mb-8">
          <div className="bg-[#091126] border border-[#1E2D5A] rounded-xl p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Flame className="w-4 h-4 text-red-400" />
                  <h2 className="text-sm font-bold text-zinc-100">Chaos Engineering</h2>
                  <span className="px-2 py-0.5 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-semibold uppercase tracking-wide">
                    Live Sim
                  </span>
                </div>
                <p className="text-xs text-zinc-400">Trigger node failures, disk corruption, or full cluster recovery in real-time.</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleSimulateOutage}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-red-400 bg-red-500/10 hover:bg-red-500/15 border border-red-500/20 transition"
                >
                  <Flame className="w-3.5 h-3.5" />
                  50% Outage
                </button>
                <button
                  onClick={handleSimulateBitRot}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-amber-400 bg-amber-500/10 hover:bg-amber-500/15 border border-amber-500/20 transition"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  Bit-Rot Test
                </button>
                <button
                  onClick={handleHealAllNodes}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-green-400 bg-green-500/10 hover:bg-green-500/15 border border-green-500/20 transition"
                >
                  <Wrench className="w-3.5 h-3.5" />
                  Heal All
                </button>
                <button
                  onClick={handleProvisionNode}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-zinc-200 bg-[#1a1a1a] hover:bg-[#1a2f60] border border-[#1E2D5A] transition"
                >
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  Add Node
                </button>
                <button
                  onClick={handleDeprovisionExcess}
                  title="Remove idle auto-provisioned nodes that hold no data"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-zinc-400 bg-[#091126]/[0.03] hover:bg-[#1a2f60] border border-blue-400/15 hover:border-blue-400/30 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clean Nodes
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ─── STORAGE NODES GRID ─────────────────────────── */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-zinc-100">Storage Nodes</h2>
              <p className="text-xs text-zinc-400 mt-0.5">Independent microservice cluster with risk-aware placement</p>
            </div>
            <span className="text-xs text-zinc-400 font-mono">{nodes.length} registered</span>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-52 bg-vault-card border border-[#1E2D5A] rounded-xl animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {nodes.map(node => (
                <NodeCard
                  key={node.id}
                  node={node}
                  onKill={handleKillNode}
                  onRecover={handleRecoverNode}
                  onInspect={handleInspectNode}
                />
              ))}
              {nodes.length === 0 && (
                <div className="col-span-4 py-16 text-center text-zinc-400 text-sm border border-[#1E2D5A] rounded-xl bg-vault-card">
                  No storage nodes found.
                </div>
              )}
            </div>
          )}
        </section>

        {/* ─── TABS: OBJECTS / REPAIRS ─────────────────────── */}
        <section>
          <div className="flex items-center gap-1 mb-4 p-1 bg-vault-card border border-[#1E2D5A] rounded-xl w-fit">
            <button
              onClick={() => setActiveTab('objects')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${activeTab === 'objects' ? 'bg-[#1a1a1a] text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              <HardDrive className="w-3.5 h-3.5" />
              Objects
              {objects.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-md bg-[#1a1a1a] text-zinc-400 text-[10px]">{objects.length}</span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('repairs')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${activeTab === 'repairs' ? 'bg-[#1a1a1a] text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Repair Log
              {repairs.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-md bg-[#1a1a1a] text-zinc-400 text-[10px]">{repairs.length}</span>
              )}
            </button>
          </div>

          {/* Objects tab */}
          {activeTab === 'objects' && (
            <div className="bg-[#091126] border border-[#1E2D5A] rounded-xl overflow-hidden">
              {/* Tab header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#1E2D5A]">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-100">Distributed Objects</h3>
                  <p className="text-xs text-zinc-400 mt-0.5">RF = 3 · Stored on node filesystems</p>
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-500 hover:bg-blue-400 text-white text-xs font-bold transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Upload className="w-3.5 h-3.5" />
                  {uploading ? 'Uploading…' : 'Upload Object'}
                </button>
              </div>

              {/* Objects table */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#1E2D5A]">
                      <th className="px-5 py-3 text-left font-medium text-zinc-400">File</th>
                      <th className="px-5 py-3 text-left font-medium text-zinc-400">Size</th>
                      <th className="px-5 py-3 text-left font-medium text-zinc-400">Health</th>
                      <th className="px-5 py-3 text-left font-medium text-zinc-400 hidden md:table-cell">Checksum</th>
                      <th className="px-5 py-3 text-left font-medium text-zinc-400">Replicas</th>
                      <th className="px-5 py-3 text-right font-medium text-zinc-400">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {objects.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-5 py-16 text-center text-zinc-400">
                          No objects stored yet. Upload a file to test placement &amp; self-healing.
                        </td>
                      </tr>
                    ) : (
                      objects.map((obj, idx) => (
                        <tr key={obj.id} className="border-b border-[#161616] hover:bg-[#091126] transition">
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-2">
                              <div className="p-1.5 bg-[#1a1a1a] rounded-md">
                                <FileText className="w-3.5 h-3.5 text-zinc-400" />
                              </div>
                              <span className="text-zinc-100 font-medium max-w-[160px] truncate">{obj.filename}</span>
                            </div>
                          </td>
                          <td className="px-5 py-3.5 text-zinc-400 font-mono">{formatBytes(obj.size)}</td>
                          <td className="px-5 py-3.5">
                            <Badge variant={obj.healthyReplicas >= 3 ? 'green' : obj.healthyReplicas > 0 ? 'amber' : 'red'}>
                              {obj.healthyReplicas}/{obj.replicationFactor}
                            </Badge>
                          </td>
                          <td className="px-5 py-3.5 hidden md:table-cell">
                            <span className="font-mono text-[11px] text-zinc-400 bg-[#091126] border border-[#1E2D5A] px-2 py-1 rounded-md">
                              {obj.checksum?.slice(0, 10)}…
                            </span>
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="flex flex-wrap gap-1">
                              {obj.replicas?.map((rep: any) => (
                                <button
                                  key={rep.id}
                                  onClick={() => handleCorruptReplica(rep.id)}
                                  title={`${rep.status} on ${rep.nodeName} — click to simulate corruption`}
                                  className={`px-2 py-0.5 rounded-md border text-[10px] font-medium transition ${
                                    rep.status === 'HEALTHY' && rep.nodeStatus !== 'FAILED'
                                      ? 'bg-[#091126] border-[#1E2D5A] text-zinc-400 hover:border-red-500/30 hover:text-red-400'
                                      : 'bg-red-500/10 border-red-500/20 text-red-400'
                                  }`}
                                >
                                  {rep.nodeName}
                                  {rep.status === 'CORRUPTED' && ' ⚠'}
                                </button>
                              ))}
                            </div>
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => handleVerifyObject(obj.id)}
                                className="p-1.5 rounded-md bg-[#091126] border border-[#1E2D5A] text-zinc-400 hover:text-zinc-100 hover:bg-[#1a2f60] transition"
                                title="Verify SHA-256 integrity"
                              >
                                <ShieldCheck className="w-3.5 h-3.5" />
                              </button>
                              <a
                                href={`${API_BASE}/objects/${obj.id}`}
                                download
                                className="p-1.5 rounded-md bg-[#091126] border border-[#1E2D5A] text-zinc-400 hover:text-zinc-100 hover:bg-[#1a2f60] transition"
                                title="Download"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </a>
                              <button
                                onClick={() => handleDeleteObject(obj.id)}
                                className="p-1.5 rounded-md bg-[#091126] border border-red-500/10 text-zinc-400 hover:text-red-400 hover:bg-red-500/8 transition"
                                title="Delete object"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Repairs tab */}
          {activeTab === 'repairs' && (
            <div className="bg-[#091126] border border-[#1E2D5A] rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#1E2D5A]">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-100">Self-Healing Repair Jobs</h3>
                  <p className="text-xs text-zinc-400 mt-0.5">BullMQ recovery engine · Auto-triggered</p>
                </div>
                <Badge variant={repairs.filter(r => r.status === 'IN_PROGRESS').length > 0 ? 'amber' : 'green'}>
                  {repairs.filter(r => r.status === 'IN_PROGRESS').length > 0
                    ? `${repairs.filter(r => r.status === 'IN_PROGRESS').length} active`
                    : 'Idle'}
                </Badge>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#1E2D5A]">
                      <th className="px-5 py-3 text-left font-medium text-zinc-400">Job ID</th>
                      <th className="px-5 py-3 text-left font-medium text-zinc-400">Reason</th>
                      <th className="px-5 py-3 text-left font-medium text-zinc-400">Source</th>
                      <th className="px-5 py-3 text-left font-medium text-zinc-400">Destination</th>
                      <th className="px-5 py-3 text-left font-medium text-zinc-400">Status</th>
                      <th className="px-5 py-3 text-right font-medium text-zinc-400">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {repairs.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-5 py-16 text-center text-zinc-400">
                          No repair jobs yet. Kill a node or corrupt a replica to watch self-healing.
                        </td>
                      </tr>
                    ) : (
                      repairs.slice(0, 20).map(job => (
                        <tr key={job.id} className="border-b border-[#161616] hover:bg-[#091126] transition">
                          <td className="px-5 py-3 font-mono text-zinc-400 text-[11px]">{job.id}</td>
                          <td className="px-5 py-3">
                            <span className="px-2 py-0.5 rounded-md bg-[#091126] border border-[#1E2D5A] text-zinc-400">{job.reason}</span>
                          </td>
                          <td className="px-5 py-3 font-mono text-zinc-400 text-[11px]">{job.sourceNodeId || '—'}</td>
                          <td className="px-5 py-3 font-mono text-zinc-400 text-[11px]">{job.destinationNodeId}</td>
                          <td className="px-5 py-3">
                            <Badge
                              variant={
                                job.status === 'COMPLETED' ? 'green' :
                                job.status === 'IN_PROGRESS' ? 'amber' : 'red'
                              }
                            >
                              {job.status}
                            </Badge>
                          </td>
                          <td className="px-5 py-3 text-right font-mono text-zinc-400 text-[11px]">
                            {new Date(job.createdAt).toLocaleTimeString()}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* ─── NODE INSPECTOR MODAL ────────────────────────── */}
      {selectedNodeDetail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) setSelectedNodeDetail(null); }}
        >
          <div className="w-full max-w-2xl bg-vault-card border border-[#1E2D5A] rounded-2xl overflow-hidden shadow-2xl">
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#1E2D5A]">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[#091126] border border-[#1E2D5A]">
                  <Server className="w-4 h-4 text-zinc-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-zinc-100">{selectedNodeDetail.name}</h3>
                  <p className="text-[11px] text-zinc-400 font-mono mt-0.5">{selectedNodeDetail.address} · {selectedNodeDetail.id}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedNodeDetail(null)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-[#1a2f60] transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 max-h-[75vh] overflow-y-auto">
              {/* Stats */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                {[
                  { label: 'Status', value: selectedNodeDetail.status, color: selectedNodeDetail.status === 'HEALTHY' ? 'text-green-400' : 'text-red-400' },
                  { label: 'Storage', value: formatBytes(selectedNodeDetail.usedStorage), color: 'text-zinc-100' },
                  { label: 'Risk Score', value: selectedNodeDetail.riskScore, color: (selectedNodeDetail.riskScore || 0) > 0.5 ? 'text-red-400' : 'text-green-400' },
                ].map(stat => (
                  <div key={stat.label} className="bg-[#091126] border border-[#1E2D5A] rounded-xl p-3">
                    <div className="text-[10px] text-zinc-400 mb-1.5 uppercase tracking-wide font-medium">{stat.label}</div>
                    <div className={`text-sm font-bold font-mono ${stat.color}`}>{stat.value}</div>
                  </div>
                ))}
              </div>

              {/* Replicas */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-bold text-zinc-200">Stored Replicas</h4>
                  <span className="text-[11px] text-zinc-400">{selectedNodeDetail.replicas?.length || 0} objects</span>
                </div>

                {!selectedNodeDetail.replicas || selectedNodeDetail.replicas.length === 0 ? (
                  <div className="py-10 text-center text-zinc-400 text-xs border border-[#1E2D5A] rounded-xl bg-[#091126]">
                    No replicas on this node yet.
                  </div>
                ) : (
                  <div className="border border-[#1E2D5A] rounded-xl overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-[#091126] border-b border-[#1E2D5A]">
                          <th className="px-4 py-2.5 text-left font-medium text-zinc-400">Filename</th>
                          <th className="px-4 py-2.5 text-left font-medium text-zinc-400">Size</th>
                          <th className="px-4 py-2.5 text-left font-medium text-zinc-400">Status</th>
                          <th className="px-4 py-2.5 text-right font-medium text-zinc-400">Test</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedNodeDetail.replicas.map((rep: any) => (
                          <tr key={rep.id} className="border-b border-[#161616] last:border-0 hover:bg-[#091126] transition">
                            <td className="px-4 py-3 flex items-center gap-2">
                              <FileText className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                              <span className="text-zinc-200 font-medium truncate max-w-[150px]">{rep.filename}</span>
                            </td>
                            <td className="px-4 py-3 font-mono text-zinc-400">{formatBytes(rep.size)}</td>
                            <td className="px-4 py-3">
                              <Badge variant={rep.status === 'HEALTHY' ? 'green' : 'red'}>
                                {rep.status}
                              </Badge>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={() => { handleCorruptReplica(rep.id); setSelectedNodeDetail(null); }}
                                className="px-2.5 py-1 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/15 text-[11px] font-medium transition"
                              >
                                Corrupt
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
