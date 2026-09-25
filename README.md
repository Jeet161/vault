# ⚡ VAULT — Self-Healing Distributed Object Storage System

**Vault** is a fault-tolerant, self-healing distributed object-storage system engineered with a **Risk-Aware Placement Engine**, automated integrity monitoring via **SHA-256 checksums**, automatic replica restoration, live database integration with **Neon PostgreSQL**, and an interactive **Chaos Engineering Mode**.

---

## 🏗 Architecture Overview

```text
                    Next.js Dashboard (Port 3000)
                           |
                           | HTTP / REST API
                           v
                 Fastify Control Plane (Port 4000)
                           |
       +-------------------+-------------------+
       |                   |                   |
       v                   v                   v
 Object Manager      Node Manager       Policy Engine
 (Upload/Download)   (Heartbeat/Health) (Risk-Aware Placement)
       |                   |                   |
       +-------------------+-------------------+
                           |
                    Neon PostgreSQL Database
                    (Metadata / Node & Replica States)
                           |
                    Recovery Engine & Integrity Engine
                    (SHA-256 Verification & Auto Repair)
                           |
       +-----------+-------+-------+-----------+
       |           |               |           |
       v           v               v           v
    Node 1      Node 2          Node 3      Node 4
  (Port 5001) (Port 5002)     (Port 5003) (Port 5004)
       |           |               |           |
      Disk        Disk            Disk        Disk
```

---

## 🌟 Key Engineering Features

### 1. Risk-Aware Placement Engine
Vault avoids naive random or round-robin node assignment. Candidate nodes are evaluated dynamically based on health penalties, storage ratio, failure history, and current load:

$$\text{RiskScore} = (\text{HealthPenalty} \times 0.40) + (\text{UsageRatio} \times 0.25) + (\text{FailurePenalty} \times 0.20) + (\text{LoadPenalty} \times 0.15)$$

* **Health Penalty**: `0.0` for `HEALTHY`, `0.2` for `RECOVERING`, `0.4` for `DEGRADED`, `1.0` for `FAILED`.
* **Selection**: Sorts nodes by lowest risk score and selects the top $N$ candidates (Configurable $RF = 3$).

### 2. Self-Healing Recovery Engine
When a node fails or loses network connectivity:
1. Control Plane's heartbeat loop detects missing health signals within 3 seconds and marks the node `FAILED`.
2. Recovery Engine scans affected objects and identifies healthy source replicas on remaining online nodes.
3. Policy Engine picks an optimal replacement target node.
4. Streams the object, verifies destination SHA-256 checksum, and restores **Replication Factor ($RF = 3$)**.

### 3. Bit Rot & SHA-256 Integrity Verification
Every replica file on disk is checked against the master object's SHA-256 hash. Mismatched replicas are automatically flagged `CORRUPTED` and replaced seamlessly from a healthy replica source.

### 4. Atomic Filesystem Writes
Storage nodes stream incoming object data to a `.tmp` file, calculate the SHA-256 checksum on the fly, and perform an **atomic rename** (`fs.renameSync`) only after writing succeeds. Partial writes never pollute cluster state.

### 5. Live Database Integration (Neon PostgreSQL + Drizzle ORM)
Object metadata, replica manifests, node states, and self-healing repair logs persist in **Neon PostgreSQL** using Drizzle ORM.

### 6. Interactive Chaos Engineering Panel
Directly simulate cluster faults from the Next.js Dashboard:
* **Kill Node**: Simulates node crash / network outage.
* **Recover Node**: Re-integrates recovered storage nodes into cluster placement.
* **Corrupt Replica**: Mutates bytes on disk to test SHA-256 checksum auto-repair.

---

## 📦 Monorepo Structure

```text
vault/
├── apps/
│   ├── web/                    # Next.js 14 Dashboard + Tailwind CSS
│   └── control-plane/          # Fastify API, Placement & Recovery Engines
├── services/
│   └── storage-node/           # Storage Node Microservice (atomic writes + disk storage)
├── packages/
│   ├── db/                     # Drizzle ORM schema, Neon PostgreSQL client repository
│   └── shared/                 # Shared TypeScript models, interfaces, risk scoring
├── docker/
│   └── Dockerfile.storage-node # Docker setup for storage microservices
├── docker-compose.yml           # Multi-node Docker Compose configuration
├── .env                        # Live Neon PostgreSQL database URL
├── package.json
└── tsconfig.json
```

---

## 🚀 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Database (.env)
Set your Neon PostgreSQL connection string in `.env`:
```env
DATABASE_URL=postgresql://neondb_owner:npg_TUA8d9lyPmbV@ep-odd-darkness-b5p8t9bv-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require
```

### 3. Run Everything (Unified Command)
Launch all 4 storage nodes, control plane API, and Next.js dashboard concurrently:

```bash
npm run dev
```

Open **[http://localhost:3000](http://localhost:3000)** in your browser.

---

## 📡 REST API Reference

### Control Plane Public API (`http://localhost:4000`)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/objects` | Upload file (`multipart/form-data`), run placement engine, replicate to 3 nodes |
| `GET` | `/objects` | List all objects with full replica status breakdown |
| `GET` | `/objects/:id` | Download file stream from a verified healthy replica |
| `DELETE` | `/objects/:id` | Delete object metadata and purge file from all storage nodes |
| `GET` | `/nodes` | Fetch cluster node statuses, storage usage, and risk scores |
| `POST` | `/objects/:id/verify` | Trigger SHA-256 integrity audit across all replicas |
| `GET` | `/repairs` | Fetch self-healing repair job logs |
| `GET` | `/metrics` | Aggregated system availability & recovery time metrics |

### Chaos Engineering APIs

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/admin/nodes/:id/fail` | Simulate node failure & trigger self-healing recovery |
| `POST` | `/admin/nodes/:id/recover` | Recover failed node to HEALTHY state |
| `POST` | `/admin/replicas/:id/corrupt` | Mutate bytes on disk for target replica to test bit rot repair |

---

## 🧪 Running Tests

Execute Vitest test suite covering SHA-256 integrity and Risk-Aware Placement scoring:

```bash
npm test
```

---

## 🎥 Hackathon Demonstration Flow

1. **Upload Object**: Upload `sample.pdf` via the dashboard. Observe Vault calculating SHA-256 and placing 3 replicas on optimal nodes.
2. **Simulate Node Failure**: Click **Kill Node** on Storage Node 3.
3. **Automatic Recovery**: Watch the Self-Healing log. Node 3 is marked `FAILED`, and Node 2 receives a new replica to restore $RF = 3$.
4. **Simulate Bit Rot**: Click **`⚡`** next to a replica to flip bits on disk.
5. **Integrity Auto-Repair**: Watch Vault detect `CHECKSUM MISMATCH` and automatically replace the corrupted replica.
