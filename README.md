<div align="center">

<br />
<img src="https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/scale.svg" alt="OpenDoc" width="80" />

# OpenDoc

### AI-Powered Document Intelligence & Citation-Grounded Q&A Platform

OpenDoc is a production-grade Retrieval-Augmented Generation (RAG) platform built for multi-document analysis, ownership-enforced retrieval, and evidence-backed question answering — powered by a hybrid dense + sparse search engine and a LangGraph orchestration layer.

<br />

<p>
  <img src="https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python" />
  <img src="https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/LangGraph-2C3E50?style=for-the-badge&logo=langchain&logoColor=white" alt="LangGraph" />
  <img src="https://img.shields.io/badge/Qdrant-FF4B4B?style=for-the-badge&logo=qdrant&logoColor=white" alt="Qdrant" />
  <img src="https://img.shields.io/badge/Neon_Postgres-31E88A?style=for-the-badge&logo=postgresql&logoColor=black" alt="Neon Postgres" />
  <img src="https://img.shields.io/badge/Sentence_Transformers-FF6F00?style=for-the-badge&logo=huggingface&logoColor=white" alt="Transformers" />
  <img src="https://img.shields.io/badge/Groq_Llama-FF5500?style=for-the-badge&logo=meta&logoColor=white" alt="Groq" />
  <img src="https://img.shields.io/badge/JWT_Auth-000000?style=for-the-badge&logo=json-web-tokens&logoColor=white" alt="JWT" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white" alt="Tailwind" />
  <img src="https://img.shields.io/badge/BM25-FF8C00?style=for-the-badge" alt="BM25" />
  <img src="https://img.shields.io/badge/Reranking-RRF-8A2BE2?style=for-the-badge" alt="RRF" />
</p>

<br />

</div>

---

## 📑 Table of Contents

- [System Architecture](#-system-architecture)
- [Key Features](#-key-features)
- [Tech Stack](#-tech-stack)
- [Prerequisites](#-prerequisites)
- [Getting Started](#-getting-started)
  - [1. Clone the Repository](#1-clone-the-repository)
  - [2. Environment Variables](#2-environment-variables)
  - [3. Set Up the Backend](#3-set-up-the-backend)
  - [4. Set Up the Frontend](#4-set-up-the-frontend)
- [Running the Application](#-running-the-application)
  - [Start the Backend API](#start-the-backend-api)
  - [Start the Frontend](#start-the-frontend)
- [API Endpoints](#-api-endpoints)
- [Project Structure](#-project-structure)
- [How the RAG Pipeline Works](#-how-the-rag-pipeline-works)
- [Testing](#-testing)
- [Live Demo Walkthrough](#-live-demo-walkthrough)
- [Multi-Tenant Security Model](#-multi-tenant-security-model)
- [Troubleshooting](#-troubleshooting)

---

## 🏗️ System Architecture

The diagram below illustrates the complete system flow — from document upload and processing through to hybrid retrieval and citation-grounded answer generation.

```mermaid
graph TD
    A[React Frontend] -->|Upload PDF/DOCX| B[FastAPI Backend]
    A -->|Secure Query| B

    subgraph FastAPI Ingestion Pipeline
        B -->|JWT Verification| C[Authentication Filter]
        C -->|Extract Text & Parse| D[Docling PDF Parser]
        D -->|Smart Chunk Sections + Sentences| E[Hierarchical Chunking Engine]
        E -->|BAAI/bge-small-en-v1.5 Embed| F[Embedding Service]
        F -->|Store Section Vectors| G[(Qdrant Vector DB: legal_sections)]
        F -->|Store Sentence Vectors| H[(Qdrant Vector DB: legal_sentences)]
        E -->|Record Metadata + Ownership| I[(Neon PostgreSQL DB)]
    end

    subgraph Hybrid Retrieval & Generation
        B -->|Orchestrate Workflow| J[LangGraph Coordinator]
        J -->|BM25 Keyword Search| G
        J -->|Dense Vector Search| G
        J -->|Query Classification| K[SUMMARY | FACT | COMPARE]
        J -->|Merge Rank Scores| L[Reciprocal Rank Fusion - RRF]
        L -->|Inject Context + Citations| M[LLM Synthesis Engine]
        M -->|Primary: Llama 3.1 via Groq| N[Groq API]
        M -->|Fallback: Gemini 2.5 Flash| O[Google Gemini]
        M -->|Return Citation-Grounded Answer| B
    end

    classDef database fill:#f9f,stroke:#333,stroke-width:2px;
    classDef engine fill:#bbf,stroke:#333,stroke-width:2px;
    classDef llm fill:#bfb,stroke:#333,stroke-width:2px;
    class G,H,I database;
    class D,E,J,L engine;
    class M,N,O llm;
```

---

## ✨ Key Features

### 1. Hybrid Retrieval — Dense + BM25 + Reciprocal Rank Fusion (RRF)

**What it does:** Combines dense semantic vector search (via `BAAI/bge-small-en-v1.5` embeddings) with keyword-based BM25 sparse search.

**Why it matters:** Semantic embeddings capture contextual meaning but can miss exact codes, section numbers, or acronyms (e.g., "§ 4.2(a)"). BM25 guarantees precision for exact identifier lookups.

**How it works:** Queries run in parallel against Qdrant's `legal_sections` and `legal_sentences` vector spaces alongside an in-memory BM25 text index. Results are merged and re-ranked using **Reciprocal Rank Fusion (RRF)** to construct the optimal context window for the LLM.

### 2. Multi-Tenant Ownership Enforcement

**What it does:** Strictly partitions documents, embeddings, and analytics per user. User A's queries can never retrieve context from User B's documents.

**How it works:** Row-level tenant tags (`owner_id`) are applied to all document metadata in PostgreSQL and injected into Qdrant embedding payload filters using `must` conditions. Every API request is authenticated via signed JWT tokens — the `sub` claim is validated against these owner tags at both the database and vector store layers.

### 3. Citation Grounding & Evidence Snippets

**What it does:** Maps every LLM-generated sentence to verifiable source fragments — including document name, section heading, page number, and text block preview.

**Why it matters:** Prevents hallucination. Users can click numbered citation chips (e.g., `[1]`, `[2]`) directly in the chat interface to scroll to and highlight the corresponding source evidence card.

**How it works:** The LangGraph `citation_node` parses `[N]` references from the generated answer, cross-references them against the retrieved chunk metadata, and returns structured citation objects. The React frontend renders clickable inline citation chips with anchor-scroll behavior.

### 4. Intelligent Query Classification

**What it does:** Automatically classifies user queries into `FACT`, `SUMMARY`, or `COMPARE` types before retrieval.

**Why it matters:** Different query types benefit from different retrieval strategies. Summary queries retrieve broader document overviews; comparison queries fetch sections from multiple documents in parallel.

### 5. Persistent Chat Sessions with Scoped Analysis

**What it does:** Users can create, rename, and delete chat sessions. Each chat supports scoped analysis — query a single document, a selection of documents, or the entire corpus.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend Framework** | FastAPI (Python 3.10+) |
| **Frontend Framework** | React 19 + Vite 8 |
| **Styling** | Tailwind CSS 4 |
| **Workflow Orchestration** | LangGraph |
| **Vector Database** | Qdrant Cloud |
| **Relational Database** | Neon PostgreSQL (Serverless) |
| **ORM** | SQLAlchemy 2.0 |
| **Embedding Model** | `BAAI/bge-small-en-v1.5` (384-dim) |
| **Sparse Retrieval** | rank-bm25 |
| **LLM (Primary)** | Llama 3.1 8B via Groq API |
| **LLM (Fallback)** | Gemini 2.5 Flash via Google AI |
| **PDF Parsing** | Docling |
| **Authentication** | JWT (python-jose) + bcrypt |
| **Rate Limiting** | slowapi |

---

## 📋 Prerequisites

Before you begin, ensure you have the following installed:

- **Python 3.10 or higher** — [Download Python](https://www.python.org/downloads/)
- **Node.js 18 or higher** — [Download Node.js](https://nodejs.org/)
- **Git** — [Download Git](https://git-scm.com/downloads)
- A **Qdrant Cloud** account (free tier available) — [Sign up here](https://cloud.qdrant.io/)
- A **Neon PostgreSQL** database (free tier available) — [Sign up here](https://neon.tech/)
- A **Groq API key** — [Get one here](https://console.groq.com/)
- A **Google Gemini API key** (for fallback) — [Get one here](https://aistudio.google.com/)

---

## 🚀 Getting Started

### 1. Clone the Repository

Open your terminal and run:

```bash
# Clone the repository
git clone https://github.com/your-username/legal-rag.git

# Navigate into the project directory
cd legal-rag
```

---

### 2. Environment Variables

The project requires several API keys and connection strings. A template is provided in `.env.example`.

```bash
# Copy the example environment file
cp .env.example .env
```

Now open `.env` in your editor and fill in the actual values:

```env
# ── Qdrant Vector Database ──────────────────────────
QDRANT_API_KEY=your_qdrant_api_key_here
QDRANT_URL=https://your-cluster-id.aws.cloud.qdrant.io

# ── LLM Providers ───────────────────────────────────
GROQ_API_KEY=your_groq_api_key_here
GEMINI_API_KEY=your_gemini_api_key_here

# ── Hugging Face (for embedding model download) ─────
HF_TOKEN=your_huggingface_token_here

# ── LangSmith Observability (optional) ──────────────
LANGSMITH_API_KEY=your_langsmith_api_key_here
LANGCHAIN_TRACING_V2=true
LANGCHAIN_PROJECT=legal-rag

# ── Neon PostgreSQL ─────────────────────────────────
DATABASE_URL=postgresql://user:password@hostname/dbname?sslmode=require

# ── JWT Authentication ──────────────────────────────
JWT_SECRET_KEY=generate_a_secure_random_string_here
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=30
```

> **⚠️ Important:** Never commit your `.env` file to version control. It is already listed in `.gitignore`.

---

### 3. Set Up the Backend

```bash
# Create a Python virtual environment
python -m venv venv

# Activate the virtual environment
# On macOS / Linux:
source venv/bin/activate

# On Windows (Command Prompt):
venv\Scripts\activate

# On Windows (PowerShell):
.\venv\Scripts\Activate.ps1

# Upgrade pip and install dependencies
pip install --upgrade pip
pip install -r requirements.txt

# Verify the installation
python -c "from src.chain import LegalRAG; print('Backend packages installed successfully!')"
```

> **Note:** The first time you run the application, `sentence-transformers` will download the `BAAI/bge-small-en-v1.5` model (approximately 130 MB). This is a one-time download cached in your Hugging Face directory.

---

### 4. Set Up the Frontend

```bash
# Navigate to the frontend directory
cd frontend

# Install Node.js dependencies
npm install

# Return to the project root
cd ..
```

---

## 🏃 Running the Application

### Start the Backend API

```bash
# From the project root, with the virtual environment activated
python -m src.api.main
```

The FastAPI server will start on **`http://localhost:8000`**.

You can access the interactive API documentation at:
- **Swagger UI:** [http://localhost:8000/docs](http://localhost:8000/docs)
- **ReDoc:** [http://localhost:8000/redoc](http://localhost:8000/redoc)

### Start the Frontend

Open a **second terminal** window:

```bash
# Navigate to the frontend directory
cd frontend

# Start the Vite development server
npm run dev
```

The React application will be available at **`http://localhost:5173`**.

---

## 📡 API Endpoints

The backend exposes the following REST endpoints under the `/api/v1` prefix:

### Authentication (`/api/v1/auth`)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|:---:|
| `POST` | `/api/v1/auth/register` | Register a new user account | No |
| `POST` | `/api/v1/auth/login` | Login and receive a JWT access token | No |
| `GET` | `/api/v1/auth/me` | Get the currently authenticated user's profile | Yes |

### Document Upload & Management (`/api/v1/upload` · `/api/v1/documents`)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|:---:|
| `POST` | `/api/v1/upload/` | Upload a PDF/DOCX document for ingestion | Yes |
| `GET` | `/api/v1/documents/` | List all documents belonging to the authenticated user | Yes |
| `GET` | `/api/v1/documents/{doc_id}` | Get metadata for a specific document | Yes |
| `DELETE` | `/api/v1/documents/{doc_id}` | Delete a document and its vectors | Yes |

### Query & Retrieval (`/api/v1/query`)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|:---:|
| `POST` | `/api/v1/query/` | Submit a question against selected documents | Yes |

### Chat Sessions (`/api/v1/chats`)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|:---:|
| `POST` | `/api/v1/chats/` | Create a new chat session | Yes |
| `GET` | `/api/v1/chats/` | List all chat sessions for the authenticated user | Yes |
| `GET` | `/api/v1/chats/{chat_id}` | Get a chat with its full message history | Yes |
| `PATCH` | `/api/v1/chats/{chat_id}` | Update chat metadata (title, scope) | Yes |
| `DELETE` | `/api/v1/chats/{chat_id}` | Delete a chat and all its messages | Yes |

### Health Check (`/api/v1/health`)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|:---:|
| `GET` | `/api/v1/health/` | Check API and database connectivity | No |

---

## 📁 Project Structure

```
legal-rag/
├── src/
│   ├── api/                    # FastAPI application
│   │   ├── main.py             # App entry point, CORS, route registration
│   │   ├── dependencies.py     # Singleton LegalRAG instance
│   │   └── routes/             # API route handlers
│   │       ├── auth.py         # Register, login, profile
│   │       ├── chats.py        # Chat session CRUD
│   │       ├── documents.py    # Document listing & deletion
│   │       ├── health.py       # Health check endpoint
│   │       ├── query.py        # RAG query endpoint
│   │       └── upload.py       # File upload & ingestion
│   │
│   ├── auth/                   # Authentication layer
│   │   ├── dependencies.py     # get_current_user dependency
│   │   ├── jwt.py              # JWT encode/decode utilities
│   │   ├── schemas.py          # Pydantic auth request/response models
│   │   └── security.py         # Password hashing (bcrypt) + user CRUD
│   │
│   ├── db/                     # Database layer
│   │   ├── base.py             # SQLAlchemy declarative Base
│   │   ├── database.py         # Engine, session factory, init_db()
│   │   └── models.py           # User, Document, QueryLog, Chat, Message
│   │
│   ├── ingestion/              # Document processing pipeline
│   │   ├── parser.py           # Docling PDF/DOCX parser
│   │   ├── chunker.py          # Hierarchical section + sentence chunking
│   │   ├── loader.py           # Chunk-to-Qdrant point conversion
│   │   ├── ingest.py           # Full ingestion orchestration
│   │   └── summarizer.py       # Document summarization
│   │
│   ├── retrieval/              # Hybrid retrieval engine
│   │   ├── retriever.py        # HierarchicalRetriever — main entry point
│   │   ├── bm25.py             # BM25 sparse keyword retriever
│   │   ├── fusion.py           # Reciprocal Rank Fusion (RRF)
│   │   ├── hybrid.py           # Dense + sparse hybrid search
│   │   ├── reranker.py         # Post-retrieval reranking
│   │   └── debug_logger.py     # Retrieval audit logging
│   │
│   ├── storage/                # Vector store layer
│   │   └── qdrant_store.py     # Qdrant client, embedder, CRUD operations
│   │
│   ├── llm/                    # LLM client abstraction
│   │   └── groq_client.py      # Groq (primary) + Gemini (fallback) generation
│   │
│   ├── workflows/              # LangGraph orchestration
│   │   └── legal_graph.py      # Retrieve → Generate → Citations pipeline
│   │
│   ├── prompts/                # Prompt templates
│   ├── security/               # Input guards (prompt injection detection)
│   ├── services/               # Business logic services
│   └── chain.py                # LegalRAG — high-level RAG interface
│
├── tests/                      # Test suite (20+ test files)
│   ├── test_api_endpoints.py
│   ├── test_auth.py
│   ├── test_chain.py
│   ├── test_graph.py
│   ├── test_hybrid.py
│   ├── test_ownership_enforcement.py
│   ├── test_retrieval.py
│   ├── test_rrf.py
│   └── ...                     # and more
│
├── scripts/                    # Utility & validation scripts
│   ├── validate_sprint2.py
│   └── validate_sprint3.py
│
├── frontend/                   # React 19 + Vite 8 frontend
│   ├── src/
│   │   ├── components/         # UI components (ChatArea, DocumentsPanel, etc.)
│   │   ├── context/            # React context providers
│   │   ├── hooks/              # Custom React hooks (useChat, useAuth)
│   │   ├── services/           # API client (axios)
│   │   ├── App.jsx             # Root application component
│   │   └── main.jsx            # Vite entry point
│   ├── package.json
│   ├── vite.config.js
│   └── tailwind.config.js
│
├── data/                       # Uploaded files (gitignored)
├── docs/                       # Project documentation
├── notebooks/                  # Jupyter notebooks for experimentation
├── .env.example                # Environment variable template
├── .env                        # Your local environment variables (gitignored)
├── .gitignore
├── requirements.txt            # Python dependencies
└── README.md                   # You are here :)
```

---

## 🔬 How the RAG Pipeline Works

When a user submits a query, the following steps execute inside the LangGraph workflow:

### Step 1: Query Classification
The system classifies the query as `FACT`, `SUMMARY`, or `COMPARE` using keyword pattern matching. This determines retrieval behavior and prompt selection.

### Step 2: Parallel Retrieval
Two retrieval strategies execute simultaneously against Qdrant:
- **Dense Retrieval:** Query embedding computed via `BAAI/bge-small-en-v1.5`, cosine similarity search against `legal_sections` and `legal_sentences` collections
- **BM25 Sparse Retrieval:** Keyword-based search against an in-memory BM25 index built from all document sections

Both searches are scoped to the user's selected documents using Qdrant `must` filter conditions on `owner_id`.

### Step 3: Reciprocal Rank Fusion (RRF)
Results from both retrieval methods are merged using RRF — a rank-based fusion algorithm that combines results without requiring score normalization. The formula is:

```
RRF(d) = Σ 1 / (k + rank_i(d))
```

Where `k = 60` and `rank_i(d)` is the rank of document `d` in the `i`-th result list.

### Step 4: Context Construction
The top-N fused chunks are sorted by score and formatted into a structured context block with source identifiers (`[1]`, `[2]`, `[N]`), document names, section headings, and page numbers.

### Step 5: LLM Generation
The context and question are injected into a prompt template and sent to **Llama 3.1 8B** via Groq's API (with automatic fallback to **Gemini 2.5 Flash** if Groq is unavailable).

### Step 6: Citation Extraction
The `citation_node` parses `[N]` references from the generated answer and maps them back to source chunks, producing structured citation objects that the frontend renders as clickable evidence chips.

---

## 🧪 Testing

The project includes a comprehensive test suite covering API endpoints, authentication, retrieval quality, ownership enforcement, and pipeline components.

```bash
# From the project root, with the virtual environment activated

# Run all tests
python -m pytest tests/ -v

# Run a specific test file
python -m pytest tests/test_auth.py -v

# Run tests with coverage report (requires pytest-cov)
python -m pytest tests/ -v --cov=src --cov-report=term-missing
```

**Key test categories:**

| Test File | What It Validates |
|-----------|-------------------|
| `test_auth.py` | User registration, login, JWT token issuance & validation |
| `test_ownership_enforcement.py` | Multi-tenant data isolation — User A cannot access User B's documents |
| `test_retrieval.py` | End-to-end retrieval with Qdrant and embedding validation |
| `test_hybrid.py` | Hybrid dense + BM25 retrieval correctness |
| `test_rrf.py` | Reciprocal Rank Fusion ranking accuracy |
| `test_graph.py` | LangGraph workflow node execution |
| `test_api_endpoints.py` | HTTP endpoint integration tests |
| `test_chain.py` | End-to-end `LegalRAG.ask()` pipeline |

---

## 🎬 Live Demo Walkthrough

Follow this predefined sequence to demonstrate all capabilities of the OpenDoc platform.

### Scenario 1: User Onboarding & First Query

1. **Register:** Navigate to `http://localhost:5173` and create a new account with your email and password.
2. **Login:** Sign in with your credentials — you'll receive a JWT token stored in the browser.
3. **Empty Workspace:** Observe the empty document workspace with a prompt to upload your first document.

### Scenario 2: Document Ingestion & Scoped Analysis

4. **Upload:** Drag and drop a PDF contract or agreement into the Document Repository panel. Wait for the ingestion pipeline to complete (text extraction → chunking → embedding → vector storage).
5. **Scoped Query:**
   - Select the uploaded document in the Scope Selector dropdown.
   - Type: *"What are the termination provisions?"*
   - Observe the "Synthesizing response..." loading indicator with staged progress messages.
6. **Citation Interaction:**
   - Inspect the formatted Markdown answer with inline citation chips `[1]`, `[2]`.
   - Click any citation chip — the interface scrolls to and highlights the corresponding source evidence card showing document name, section heading, page number, and a text preview.

### Scenario 3: Cross-Document Analysis

7. **Multi-Document Corpus:**
   - Upload 2–3 additional documents.
   - Set the Scope Selector to "All Documents".
   - Query: *"Compare the termination provisions across my documents."*
   - Observe that OpenDoc synthesizes an answer referencing multiple documents simultaneously, each with distinct citation references.

### Scenario 4: Ownership & Tenant Isolation

8. **Verification of Isolation:**
   - Log out from the current session.
   - Register or login as a **different user**.
   - Verify that the new user's Document Repository is completely empty.
   - User A's uploaded documents, vector embeddings, and chat history are completely invisible and inaccessible to User B.

---

## 🔒 Multi-Tenant Security Model

OpenDoc implements a defense-in-depth approach to data isolation:

| Layer | Mechanism |
|-------|-----------|
| **API Gateway** | Every request requires a valid JWT in the `Authorization: Bearer` header |
| **PostgreSQL** | All tables include `owner_id` with foreign key constraints; queries always filter by authenticated user |
| **Qdrant** | Every vector point payload includes `owner_id`; all search operations use `must` filter conditions |
| **File Storage** | Uploaded files are stored with user-scoped paths |
| **Frontend** | Auth context provides the user identity; API client attaches JWT to every request automatically |

---

## 🔧 Troubleshooting

<details>
<summary><b>Qdrant connection error</b></summary>

Ensure your `QDRANT_URL` is correct and includes `https://`. For Qdrant Cloud, the URL format is:
```
https://your-cluster-id.aws.cloud.qdrant.io:6333
```
Verify your API key has read/write permissions.
</details>

<details>
<summary><b>PostgreSQL connection error</b></summary>

Your `DATABASE_URL` must include `?sslmode=require` for Neon connections:
```
postgresql://user:password@ep-xxxx.us-east-1.aws.neon.tech/dbname?sslmode=require
```
</details>

<details>
<summary><b>Embedding model download fails</b></summary>

Set your `HF_TOKEN` in `.env` to authenticate with Hugging Face. If you're behind a proxy, set `HF_HUB_ENABLE_HF_TRANSFER=1`.
</details>

<details>
<summary><b>Groq rate limit / 429 errors</b></summary>

The system will automatically fall back to Gemini 2.5 Flash. Ensure your `GEMINI_API_KEY` is set. If both providers fail, check your API quotas.
</details>

<details>
<summary><b>Frontend CORS errors</b></summary>

The backend is configured to allow `http://localhost:5173`. If you're running the frontend on a different port, update the `allow_origins` list in `src/api/main.py`.
</details>

<details>
<summary><b>Port 8000 already in use</b></summary>

```bash
# Find and kill the process on port 8000
# On macOS/Linux:
lsof -ti:8000 | xargs kill -9

# On Windows:
netstat -ano | findstr :8000
taskkill /PID <PID> /F
```
</details>

---

## 📄 License

This project is provided for educational and demonstration purposes. Contact the repository owner for licensing details.

---

<br />

<div align="center">
  <sub>Built with ❤️ using FastAPI, React, LangGraph, Qdrant & Neon</sub>
</div>
