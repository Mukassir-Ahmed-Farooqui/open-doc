import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_URL,
});

// Attach JWT token automatically
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Auto redirect on 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (!window.location.pathname.includes('/login') && !window.location.pathname.includes('/register')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export const authService = {
  async register(email, password, fullName) {
    const response = await api.post('/api/v1/auth/register', {
      email,
      password,
      full_name: fullName,
    });
    return response.data;
  },

  async login(email, password) {
    const response = await api.post('/api/v1/auth/login', {
      email,
      password,
    });
    return response.data; // Expected response: { access_token, token_type }
  },
};

export const documentService = {
  async list() {
    const response = await api.get('/api/v1/documents');
    return response.data; // Expected: [{ doc_id, filename }]
  },

  async upload(file, onProgress) {
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post('/api/v1/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress(percent);
        }
      },
    });
    return response.data; // Expected: { doc_id, filename, sections, sentences, status }
  },

  async delete(docId) {
    const response = await api.delete(`/api/v1/documents/${docId}`);
    return response.data;
  },
};

export const queryService = {
  async ask(question, selectedDocIds = []) {
    const payload = { 
      question,
      selected_doc_ids: selectedDocIds,
    };
    const response = await api.post('/api/v1/query', payload);
    return response.data; // Expected: { answer, citations: [...] }
  },
};

export const chatService = {
  async list() {
    const response = await api.get('/api/v1/chats');
    return response.data; // Expected: [{ id, title, selected_doc_ids, created_at, updated_at }]
  },

  async create(selectedDocIds = []) {
    const payload = { selected_doc_ids: selectedDocIds };
    const response = await api.post('/api/v1/chats', payload);
    return response.data;
  },

  async getDetail(chatId) {
    const response = await api.get(`/api/v1/chats/${chatId}`);
    return response.data; // Expected: { id, title, selected_doc_ids, messages: [...] }
  },

  async rename(chatId, title) {
    const response = await api.patch(`/api/v1/chats/${chatId}`, { title });
    return response.data;
  },

  async updateWorkspaceDocs(chatId, selectedDocIds = []) {
    const response = await api.patch(`/api/v1/chats/${chatId}/documents`, {
      selected_doc_ids: selectedDocIds,
    });
    return response.data;
  },

  async delete(chatId) {
    const response = await api.delete(`/api/v1/chats/${chatId}`);
    return response.data;
  },

  async sendMessage(chatId, question) {
    const response = await api.post(`/api/v1/chats/${chatId}/messages`, { question });
    return response.data; // Expected: MessageResponse
  },
};

export const profileService = {
  async getProfile() {
    const response = await api.get('/api/v1/auth/me');
    return response.data; // Expected: { id, email, full_name, created_at }
  }
};

export const truncateFilename = (filename, maxLength = 30) => {
  if (!filename || filename.length <= maxLength) return filename;
  const dotIndex = filename.lastIndexOf('.');
  let ext = '';
  let name = filename;
  if (dotIndex !== -1) {
    ext = filename.slice(dotIndex);
    name = filename.slice(0, dotIndex);
  }
  
  const nameLengthNeeded = maxLength - ext.length - 3;
  if (nameLengthNeeded <= 5) {
    return filename.slice(0, maxLength - 3) + '...';
  }
  const prefixLength = Math.ceil(nameLengthNeeded * 0.6);
  const suffixLength = Math.floor(nameLengthNeeded * 0.4);
  
  return name.slice(0, prefixLength) + '...' + name.slice(name.length - suffixLength) + ext;
};

export default api;
