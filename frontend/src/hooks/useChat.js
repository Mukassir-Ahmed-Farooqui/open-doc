import { useState, useEffect, useCallback } from 'react';
import { chatService } from '../services/api';
import toast from 'react-hot-toast';

export const useChat = (isAuthenticated, documents = []) => {
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isQuerying, setIsQuerying] = useState(false);
  const [isLoadingChats, setIsLoadingChats] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  // Active chat metadata derived from state
  const activeChat = chats.find((c) => c.id === activeChatId) || null;
  const selectedDocIds = activeChat ? activeChat.selected_doc_ids || [] : [];

  // Loads messages for a specific chat ID
  const loadChatMessages = useCallback(async (chatId) => {
    setIsLoadingMessages(true);
    try {
      const detail = await chatService.getDetail(chatId);
      // Map messages format from API response to state
      const mapped = (detail.messages || []).map((msg) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        citations: msg.citations || [],
        latencyMs: msg.latency_ms,
        timestamp: new Date(msg.timestamp),
      }));
      setMessages(mapped);
    } catch (err) {
      console.error("Failed to load messages for chat:", chatId, err);
      toast.error("Failed to load conversation history.");
    } finally {
      setIsLoadingMessages(false);
    }
  }, []);

  // Loads the list of chats for the current user
  const loadChats = useCallback(async (selectDefaultId = null) => {
    setIsLoadingChats(true);
    try {
      const list = await chatService.list();
      setChats(list);

      if (list.length > 0) {
        // Decide which chat to select
        const targetId = selectDefaultId || list[0].id;
        const exists = list.some((c) => c.id === targetId);
        const finalId = exists ? targetId : list[0].id;
        setActiveChatId(finalId);
        await loadChatMessages(finalId);
      } else {
        // No chats exist yet. Create the initial one automatically.
        const defaultWorkspaceMode = localStorage.getItem('cs_default_workspace') || 'all';
        const initialSelection = defaultWorkspaceMode === 'all' 
          ? documents.map(d => d.doc_id) 
          : [];
        const newChat = await chatService.create(initialSelection);
        setChats([newChat]);
        setActiveChatId(newChat.id);
        setMessages([]);
      }
    } catch (err) {
      console.error("Failed to load chats:", err);
      toast.error("Failed to load chat history.");
    } finally {
      setIsLoadingChats(false);
    }
  }, [loadChatMessages, documents]);

  // Handle loading chat list when authentication changes
  useEffect(() => {
    if (isAuthenticated) {
      loadChats();
    } else {
      // Clear state when logged out
      setChats([]);
      setActiveChatId(null);
      setMessages([]);
    }
  }, [isAuthenticated, loadChats]);

  // Switch active chat session
  const selectChat = async (chatId) => {
    if (chatId === activeChatId) return;
    setActiveChatId(chatId);
    await loadChatMessages(chatId);
  };

  // Create a new empty chat session
  const handleCreateChat = async (selectedDocIds = []) => {
    setIsLoadingChats(true);
    try {
      const newChat = await chatService.create(selectedDocIds);
      setChats((prev) => [newChat, ...prev]);
      setActiveChatId(newChat.id);
      setMessages([]);
      toast.success("New chat session created.");
      return newChat;
    } catch (err) {
      console.error("Failed to create chat:", err);
      toast.error("Failed to start new chat.");
    } finally {
      setIsLoadingChats(false);
    }
  };

  // Rename the current chat session
  const handleRenameChat = async (chatId, title) => {
    if (!title || !title.trim()) return;
    try {
      const updated = await chatService.rename(chatId, title);
      setChats((prev) =>
        prev.map((c) => (c.id === chatId ? { ...c, title: updated.title } : c))
      );
      toast.success("Chat renamed successfully.");
    } catch (err) {
      console.error("Failed to rename chat:", err);
      toast.error("Failed to rename chat.");
    }
  };

  // Delete a chat session
  const handleDeleteChat = async (chatId) => {
    const confirm = window.confirm("Are you sure you want to delete this chat session? All historical messages will be permanently lost.");
    if (!confirm) return;

    try {
      await chatService.delete(chatId);
      const remaining = chats.filter((c) => c.id !== chatId);
      setChats(remaining);

      // If we deleted the active chat, select another one
      if (activeChatId === chatId) {
        if (remaining.length > 0) {
          setActiveChatId(remaining[0].id);
          await loadChatMessages(remaining[0].id);
        } else {
          // No chats left. Auto-create a new one to prevent orphaned UI.
          const newChat = await chatService.create([]);
          setChats([newChat]);
          setActiveChatId(newChat.id);
          setMessages([]);
        }
      }
      toast.success("Chat deleted.");
    } catch (err) {
      console.error("Failed to delete chat:", err);
      toast.error("Failed to delete chat.");
    }
  };

  // Update selected document IDs of the chat session
  const handleUpdateWorkspaceDocs = async (chatId, selectedDocIds) => {
    try {
      const updated = await chatService.updateWorkspaceDocs(chatId, selectedDocIds);
      setChats((prev) =>
        prev.map((c) =>
          c.id === chatId
            ? { ...c, selected_doc_ids: updated.selected_doc_ids }
            : c
        )
      );
      toast.success("Workspace document selection updated.");
    } catch (err) {
      console.error("Failed to update workspace documents:", err);
      if (err.response && err.response.data && err.response.data.detail) {
        toast.error(err.response.data.detail);
      } else {
        toast.error("Failed to update document selection.");
      }
    }
  };

  // Ask a question in the current active chat session
  const askQuestion = async (question) => {
    if (!question || !question.trim() || !activeChatId) return;

    setIsQuerying(true);

    const tempUserMsgId = Math.random().toString(36).substring(7);
    const userMessage = {
      id: tempUserMsgId,
      role: 'user',
      content: question,
      timestamp: new Date(),
    };

    // Append user message immediately for local visual continuity
    setMessages((prev) => [...prev, userMessage]);

    try {
      const res = await chatService.sendMessage(activeChatId, question);

      const assistantMessage = {
        id: res.id,
        role: res.role,
        content: res.content || 'No response details received.',
        citations: res.citations || [],
        latencyMs: res.latency_ms,
        timestamp: new Date(res.timestamp),
      };

      setMessages((prev) => {
        // Filter out the temp user message to avoid duplicate keys when re-rendering
        const filtered = prev.filter((m) => m.id !== tempUserMsgId);
        // Append the persisted user message and the assistant message
        return [
          ...filtered,
          {
            id: tempUserMsgId, // Keep visual continuity or map to DB ID if needed
            role: 'user',
            content: question,
            timestamp: new Date(),
          },
          assistantMessage,
        ];
      });

      // Reload the chat list because the chat's `updated_at` and potentially `title` (first question) changed.
      // We pass activeChatId so that the current active chat remains selected.
      await loadChats(activeChatId);
    } catch (error) {
      console.error("Query failed:", error);
      let userMessageText = 'Unable to generate an answer. Please try again or rephrase your question.';
      if (error.response && error.response.data && error.response.data.detail) {
        userMessageText = error.response.data.detail;
      } else if (!error.response) {
        userMessageText = 'The request could not be completed. Check your connection and try again.';
      }

      const errorMessage = {
        id: Math.random().toString(36).substring(7),
        role: 'assistant',
        content: userMessageText,
        isError: true,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsQuerying(false);
    }
  };

  return {
    chats,
    activeChatId,
    activeChat,
    selectedDocIds,
    messages,
    isQuerying,
    isLoadingChats,
    isLoadingMessages,
    askQuestion,
    selectChat,
    handleCreateChat,
    handleRenameChat,
    handleDeleteChat,
    handleUpdateWorkspaceDocs,
  };
};
