import React, { useState, useEffect, useRef } from 'react';

// Regex patterns matching backend validations
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,30}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_CATEGORIES = ['General', 'Finance', 'HR', 'Legal', 'IT', 'Education', 'Personal'];

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  // Global flash messages
  const [globalError, setGlobalError] = useState('');
  const [globalSuccess, setGlobalSuccess] = useState('');

  // Active document for "Manage Access" modal
  const [accessModalDoc, setAccessModalDoc] = useState(null);

  // Active document for "Edit Document" modal
  const [editModalDoc, setEditModalDoc] = useState(null);

  const accountMenuRef = useRef(null);

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setCurrentView('dashboard');
      } else {
        setUser(null);
        setCurrentView('login');
      }
    } catch (err) {
      console.error('Session check failed:', err);
      setUser(null);
      setCurrentView('login');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  // Close account dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target)) {
        setAccountMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
      setUser(null);
      setCurrentView('login');
      setAccountMenuOpen(false);
      setGlobalSuccess('Signed out successfully');
      setGlobalError('');
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  if (loading) {
    return (
      <div className="auth-page">
        <div className="card" style={{ textAlign: 'center', width: '380px' }}>
          <p style={{ color: 'var(--text-secondary)' }}>Verifying secure session...</p>
        </div>
      </div>
    );
  }

  // Unauthenticated screen
  if (!user) {
    return (
      <div className="auth-page">
        <div className="auth-container">
          <div className="card">
            <div className="brand-header">
              <div className="brand-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" color="#fff">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                  <circle cx="12" cy="11" r="3"/>
                </svg>
              </div>
              <h1 className="brand-title">TrustVault</h1>
              <p className="brand-subtitle">
                {currentView === 'register' ? 'Create your TrustVault account' : 'Secure document repository with strict access control'}
              </p>
            </div>

            {globalError && (
              <div className="alert-box alert-error" role="alert">
                <span>{globalError}</span>
              </div>
            )}

            {globalSuccess && (
              <div className="alert-box alert-success" role="status">
                <span>{globalSuccess}</span>
              </div>
            )}

            {currentView === 'register' ? (
              <RegisterForm
                onRegisterSuccess={() => {
                  setGlobalError('');
                  setGlobalSuccess('Registration successful! Please sign in with your credentials.');
                  setCurrentView('login');
                }}
                onSwitchToLogin={() => {
                  setGlobalError('');
                  setGlobalSuccess('');
                  setCurrentView('login');
                }}
              />
            ) : (
              <SignInForm
                onLoginSuccess={(loggedInUser) => {
                  setUser(loggedInUser);
                  setGlobalError('');
                  setGlobalSuccess('');
                  setCurrentView('dashboard');
                }}
                onSwitchToRegister={() => {
                  setGlobalError('');
                  setGlobalSuccess('');
                  setCurrentView('register');
                }}
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  const isAdmin = user.role === 'admin';

  return (
    <div className="app-layout">
      {/* Left Sidebar */}
      <aside className={`app-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header" onClick={() => { setCurrentView('dashboard'); setSidebarOpen(false); }}>
          <div className="brand-icon-sm">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" color="#fff">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              <circle cx="12" cy="11" r="3"/>
            </svg>
          </div>
          <span className="brand-title-sm">TrustVault</span>
        </div>

        <nav className="sidebar-nav">
          {/* User Links */}
          {!isAdmin ? (
            <>
              <button
                className={`sidebar-item ${currentView === 'dashboard' ? 'active' : ''}`}
                onClick={() => { setCurrentView('dashboard'); setSidebarOpen(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="7"/>
                  <rect x="14" y="3" width="7" height="7"/>
                  <rect x="14" y="14" width="7" height="7"/>
                  <rect x="3" y="14" width="7" height="7"/>
                </svg>
                Dashboard
              </button>

              <button
                className={`sidebar-item ${currentView === 'my_documents' ? 'active' : ''}`}
                onClick={() => { setCurrentView('my_documents'); setSidebarOpen(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                  <polyline points="10 9 9 9 8 9"/>
                </svg>
                My Documents
              </button>

              <button
                className={`sidebar-item ${currentView === 'shared_with_me' ? 'active' : ''}`}
                onClick={() => { setCurrentView('shared_with_me'); setSidebarOpen(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                Shared with Me
              </button>

              <button
                className={`sidebar-item ${currentView === 'search' ? 'active' : ''}`}
                onClick={() => { setCurrentView('search'); setSidebarOpen(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8"/>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                Search Documents
              </button>

              <button
                className={`sidebar-item ${currentView === 'categories' ? 'active' : ''}`}
                onClick={() => { setCurrentView('categories'); setSidebarOpen(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                Categories
              </button>

              <button
                className={`sidebar-item ${currentView === 'upload' ? 'active' : ''}`}
                onClick={() => { setCurrentView('upload'); setSidebarOpen(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                Upload Document
              </button>
            </>
          ) : (
            /* Admin Links */
            <>
              <button
                className={`sidebar-item ${currentView === 'dashboard' ? 'active' : ''}`}
                onClick={() => { setCurrentView('dashboard'); setSidebarOpen(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="7"/>
                  <rect x="14" y="3" width="7" height="7"/>
                  <rect x="14" y="14" width="7" height="7"/>
                  <rect x="3" y="14" width="7" height="7"/>
                </svg>
                Dashboard
              </button>

              <button
                className={`sidebar-item ${currentView === 'all_documents' ? 'active' : ''}`}
                onClick={() => { setCurrentView('all_documents'); setSidebarOpen(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
                All Documents
              </button>

              <button
                className={`sidebar-item ${currentView === 'users' ? 'active' : ''}`}
                onClick={() => { setCurrentView('users'); setSidebarOpen(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                Users
              </button>

              <button
                className={`sidebar-item ${currentView === 'search' ? 'active' : ''}`}
                onClick={() => { setCurrentView('search'); setSidebarOpen(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8"/>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                Search Documents
              </button>

              <button
                className={`sidebar-item ${currentView === 'categories' ? 'active' : ''}`}
                onClick={() => { setCurrentView('categories'); setSidebarOpen(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                Categories
              </button>
            </>
          )}
        </nav>
      </aside>

      {/* Main Container */}
      <div className="main-wrapper">
        {/* Topbar */}
        <header className="app-topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu-btn"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label="Toggle menu"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="12" x2="21" y2="12"/>
                <line x1="3" y1="6" x2="21" y2="6"/>
                <line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            </button>
            <span className="topbar-title">
              {currentView === 'dashboard' && 'Dashboard'}
              {currentView === 'my_documents' && 'My Documents'}
              {currentView === 'shared_with_me' && 'Shared with Me'}
              {currentView === 'all_documents' && 'All Documents'}
              {currentView === 'users' && 'User Management'}
              {currentView === 'search' && 'Search Documents'}
              {currentView === 'categories' && 'Document Categories'}
              {currentView === 'upload' && 'Upload Document'}
              {currentView === 'profile' && 'My Profile'}
            </span>
          </div>

          {/* Top Right: Account Initial Icon & Dropdown ONLY */}
          <div className="account-wrapper" ref={accountMenuRef}>
            <button
              className="avatar-btn"
              onClick={() => setAccountMenuOpen(!accountMenuOpen)}
              aria-label="Account menu"
            >
              {(user.username || user.email || 'U').charAt(0).toUpperCase()}
            </button>

            {accountMenuOpen && (
              <div className="account-dropdown">
                <div className="dropdown-user-header">
                  <div className="dropdown-username">{user.username || 'User'}</div>
                  <div className="dropdown-email">{user.email}</div>
                  <div style={{ marginTop: '6px' }}>
                    <span className={`user-badge role-${user.role}`}>{user.role}</span>
                  </div>
                </div>

                <div className="dropdown-actions">
                  <button
                    className="dropdown-item"
                    onClick={() => {
                      setCurrentView('profile');
                      setAccountMenuOpen(false);
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                      <circle cx="12" cy="7" r="4"/>
                    </svg>
                    My Profile
                  </button>

                  <button
                    className="dropdown-item logout"
                    onClick={handleLogout}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                      <polyline points="16 17 21 12 16 7"/>
                      <line x1="21" y1="12" x2="9" y2="12"/>
                    </svg>
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Content Body */}
        <main className="app-content">
          {globalSuccess && (
            <div className="alert-box alert-success" role="status">
              <span>{globalSuccess}</span>
            </div>
          )}

          {globalError && (
            <div className="alert-box alert-error" role="alert">
              <span>{globalError}</span>
            </div>
          )}

          {/* User Dashboard */}
          {currentView === 'dashboard' && !isAdmin && (
            <UserDashboardView
              user={user}
              onGoUpload={() => setCurrentView('upload')}
              onManageAccess={(doc) => setAccessModalDoc(doc)}
              onEditDoc={(doc) => setEditModalDoc(doc)}
            />
          )}

          {/* Admin Dashboard */}
          {currentView === 'dashboard' && isAdmin && (
            <AdminDashboardView
              onManageAccess={(doc) => setAccessModalDoc(doc)}
            />
          )}

          {/* My Documents (User) */}
          {currentView === 'my_documents' && (
            <MyDocumentsView
              onManageAccess={(doc) => setAccessModalDoc(doc)}
              onGoUpload={() => setCurrentView('upload')}
            />
          )}

          {/* Shared with Me (User) */}
          {currentView === 'shared_with_me' && (
            <SharedWithMeView
              onEditDoc={(doc) => setEditModalDoc(doc)}
            />
          )}

          {/* All Documents (Admin) */}
          {currentView === 'all_documents' && isAdmin && (
            <AllDocumentsAdminView
              onManageAccess={(doc) => setAccessModalDoc(doc)}
            />
          )}

          {/* Users Page (Admin) */}
          {currentView === 'users' && isAdmin && (
            <UsersAdminView user={user} />
          )}

          {/* Search Documents Page */}
          {currentView === 'search' && (
            <SearchDocumentsView
              isAdmin={isAdmin}
              onManageAccess={(doc) => setAccessModalDoc(doc)}
              onEditDoc={(doc) => setEditModalDoc(doc)}
            />
          )}

          {/* Categories Page */}
          {currentView === 'categories' && (
            <CategoriesView
              isAdmin={isAdmin}
              onManageAccess={(doc) => setAccessModalDoc(doc)}
              onEditDoc={(doc) => setEditModalDoc(doc)}
            />
          )}

          {/* Upload Page */}
          {currentView === 'upload' && (
            <UploadPageView
              onUploadSuccess={() => {
                setGlobalSuccess('Document uploaded and encrypted in vault.');
                setCurrentView('my_documents');
              }}
            />
          )}

          {/* My Profile Page */}
          {currentView === 'profile' && (
            <MyProfileView
              user={user}
              onUserUpdated={(updatedUser) => setUser(updatedUser)}
            />
          )}
        </main>
      </div>

      {/* Manage Access Dialog Modal */}
      {accessModalDoc && (
        <ManageAccessModal
          doc={accessModalDoc}
          isAdmin={isAdmin}
          onClose={() => setAccessModalDoc(null)}
        />
      )}

      {/* Edit Document Modal */}
      {editModalDoc && (
        <EditDocumentModal
          doc={editModalDoc}
          onClose={() => setEditModalDoc(null)}
          onSaved={() => {
            setEditModalDoc(null);
            setGlobalSuccess('Document metadata updated');
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper Formatters
// ---------------------------------------------------------------------------
function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return '0 B';
  const num = parseInt(bytes, 10);
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / (1024 * 1024)).toFixed(2)} MB`;
}

async function triggerDownload(docId, filename) {
  try {
    const res = await fetch(`/api/documents/${docId}/download`, { credentials: 'include' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Download failed or permission denied');
    }
    const blob = await res.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(downloadUrl);
  } catch (err) {
    alert(err.message);
  }
}

// ---------------------------------------------------------------------------
// User Dashboard View (Counts + 5 most recent docs)
// ---------------------------------------------------------------------------
function UserDashboardView({ user, onGoUpload, onManageAccess, onEditDoc }) {
  const [recentDocs, setRecentDocs] = useState([]);
  const [mineCount, setMineCount] = useState(0);
  const [sharedCount, setSharedCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/documents', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        const docs = data.documents || [];
        setMineCount(docs.filter((d) => d.is_owner).length);
        setSharedCount(docs.filter((d) => !d.is_owner).length);
        setRecentDocs(docs.slice(0, 5));
      }
    } catch (err) {
      console.error('Failed to load user dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  return (
    <div>
      <div className="metrics-row">
        <div className="metric-card">
          <span className="metric-label">My Documents</span>
          <div className="metric-value">{mineCount}</div>
        </div>

        <div className="metric-card">
          <span className="metric-label">Shared with Me</span>
          <div className="metric-value">{sharedCount}</div>
        </div>
      </div>

      <div className="table-card">
        <div className="table-header-row">
          <h2 className="table-title">Recent Documents</h2>
          <button onClick={onGoUpload} className="btn-primary" style={{ padding: '6px 14px', fontSize: '0.8125rem' }}>
            + Upload
          </button>
        </div>

        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading documents...</div>
        ) : recentDocs.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            No documents in your vault yet.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Category</th>
                <th>Access</th>
                <th>Owner</th>
                <th>Size</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {recentDocs.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    <strong>{doc.title}</strong>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{doc.original_filename}</div>
                  </td>
                  <td>{doc.category || 'General'}</td>
                  <td>
                    {doc.is_owner ? (
                      <span className="perm-badge perm-owner">Owner</span>
                    ) : (
                      <span className="perm-badge perm-shared">Shared ({doc.my_permission})</span>
                    )}
                  </td>
                  <td>{doc.owner_username}</td>
                  <td>{formatBytes(doc.size_bytes)}</td>
                  <td>
                    <div className="actions-cell">
                      <button
                        className="btn-outline"
                        onClick={() => triggerDownload(doc.id, doc.original_filename)}
                      >
                        Download
                      </button>
                      {doc.is_owner && (
                        <button
                          className="btn-outline"
                          onClick={() => onManageAccess(doc)}
                        >
                          Manage Access
                        </button>
                      )}
                      {doc.my_permission === 'edit' && (
                        <button
                          className="btn-outline"
                          onClick={() => onEditDoc(doc)}
                        >
                          Edit
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin Dashboard View (User & doc counts + 5 most recent uploads)
// ---------------------------------------------------------------------------
function AdminDashboardView({ onManageAccess }) {
  const [userCount, setUserCount] = useState(0);
  const [docCount, setDocCount] = useState(0);
  const [recentUploads, setRecentUploads] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadAdminData = async () => {
    try {
      setLoading(true);
      const [docsRes, usersRes] = await Promise.all([
        fetch('/api/documents', { credentials: 'include' }),
        fetch('/api/users', { credentials: 'include' })
      ]);

      if (docsRes.ok) {
        const dData = await docsRes.json();
        const docs = dData.documents || [];
        setDocCount(docs.length);
        setRecentUploads(docs.slice(0, 5));
      }

      if (usersRes.ok) {
        const uData = await usersRes.json();
        setUserCount((uData.users || []).length);
      }
    } catch (err) {
      console.error('Failed to load admin metrics:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAdminData();
  }, []);

  return (
    <div>
      <div className="metrics-row">
        <div className="metric-card">
          <span className="metric-label">Total Users</span>
          <div className="metric-value">{userCount}</div>
        </div>

        <div className="metric-card">
          <span className="metric-label">Total Documents</span>
          <div className="metric-value">{docCount}</div>
        </div>
      </div>

      <div className="table-card">
        <div className="table-header-row">
          <h2 className="table-title">Recent Uploads (Metadata Only)</h2>
        </div>

        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading metadata...</div>
        ) : recentUploads.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>No uploads found.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Owner</th>
                <th>Category</th>
                <th>Size</th>
                <th>Upload Date</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {recentUploads.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    <strong>{doc.title}</strong>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{doc.original_filename}</div>
                  </td>
                  <td>{doc.owner_username}</td>
                  <td>{doc.category || 'General'}</td>
                  <td>{formatBytes(doc.size_bytes)}</td>
                  <td>{new Date(doc.created_at).toLocaleDateString()}</td>
                  <td>
                    <div className="actions-cell">
                      <button
                        className="btn-outline"
                        onClick={() => onManageAccess(doc)}
                      >
                        Manage Access
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// My Documents Page (Owner: Download, Manage Access, Delete)
// ---------------------------------------------------------------------------
function MyDocumentsView({ onManageAccess, onGoUpload }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  const loadMine = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/documents?scope=mine', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setDocs(data.documents || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMine();
  }, []);

  const handleDelete = async (doc) => {
    if (!window.confirm(`Are you sure you want to delete "${doc.title}"?`)) return;

    try {
      const res = await fetch(`/api/documents/${doc.id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (res.ok) {
        setMsg(`Document "${doc.title}" was deleted.`);
        loadMine();
      } else {
        alert('Failed to delete document');
      }
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div>
      <div className="section-actions">
        <h2 className="table-title" style={{ fontSize: '1.25rem' }}>Documents I Own</h2>
        <button onClick={onGoUpload} className="btn-primary" style={{ padding: '8px 16px', fontSize: '0.875rem' }}>
          + Upload Document
        </button>
      </div>

      {msg && <div className="alert-box alert-success">{msg}</div>}

      <div className="table-card">
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading your documents...</div>
        ) : docs.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            You haven't uploaded any documents yet.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Category</th>
                <th>Size</th>
                <th>Date</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    <strong>{doc.title}</strong>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{doc.original_filename}</div>
                  </td>
                  <td>{doc.category || 'General'}</td>
                  <td>{formatBytes(doc.size_bytes)}</td>
                  <td>{new Date(doc.created_at).toLocaleDateString()}</td>
                  <td>
                    <div className="actions-cell">
                      <button
                        className="btn-outline"
                        onClick={() => triggerDownload(doc.id, doc.original_filename)}
                      >
                        Download
                      </button>
                      <button
                        className="btn-outline"
                        onClick={() => onManageAccess(doc)}
                      >
                        Manage Access
                      </button>
                      <button
                        className="btn-danger"
                        onClick={() => handleDelete(doc)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared with Me Page (Download for both, Edit only if permission === 'edit')
// ---------------------------------------------------------------------------
function SharedWithMeView({ onEditDoc }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadShared = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/documents?scope=shared', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setDocs(data.documents || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadShared();
  }, []);

  return (
    <div>
      <div className="section-actions">
        <h2 className="table-title" style={{ fontSize: '1.25rem' }}>Documents Shared with Me</h2>
      </div>

      <div className="table-card">
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading shared documents...</div>
        ) : docs.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            No documents have been shared with your account yet.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Owner</th>
                <th>Permission</th>
                <th>Date</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    <strong>{doc.title}</strong>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{doc.original_filename}</div>
                  </td>
                  <td>{doc.owner_username}</td>
                  <td>
                    <span className={`perm-badge perm-${doc.my_permission}`}>
                      {doc.my_permission === 'edit' ? 'Edit' : 'Read'}
                    </span>
                  </td>
                  <td>{new Date(doc.created_at).toLocaleDateString()}</td>
                  <td>
                    <div className="actions-cell">
                      <button
                        className="btn-outline"
                        onClick={() => triggerDownload(doc.id, doc.original_filename)}
                      >
                        Download
                      </button>

                      {doc.my_permission === 'edit' && (
                        <button
                          className="btn-outline"
                          onClick={() => onEditDoc(doc)}
                        >
                          Edit
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// All Documents View (Admin: Delete and Manage Access only, no download)
// ---------------------------------------------------------------------------
function AllDocumentsAdminView({ onManageAccess }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  const loadAll = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/documents', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setDocs(data.documents || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleDelete = async (doc) => {
    if (!window.confirm(`Are you sure you want to delete "${doc.title}"?`)) return;

    try {
      const res = await fetch(`/api/documents/${doc.id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (res.ok) {
        setMsg(`Document "${doc.title}" deleted.`);
        loadAll();
      } else {
        alert('Failed to delete document');
      }
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div>
      <div className="section-actions">
        <h2 className="table-title" style={{ fontSize: '1.25rem' }}>All Vault Documents (Admin Inspection)</h2>
      </div>

      {msg && <div className="alert-box alert-success">{msg}</div>}

      <div className="table-card">
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading repository...</div>
        ) : docs.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>No documents found.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Owner</th>
                <th>Category</th>
                <th>Size</th>
                <th>Shared With</th>
                <th>Date</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    <strong>{doc.title}</strong>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{doc.original_filename}</div>
                  </td>
                  <td>{doc.owner_username}</td>
                  <td>{doc.category || 'General'}</td>
                  <td>{formatBytes(doc.size_bytes)}</td>
                  <td>{doc.shared_count || 0} user(s)</td>
                  <td>{new Date(doc.created_at).toLocaleDateString()}</td>
                  <td>
                    <div className="actions-cell">
                      <button
                        className="btn-outline"
                        onClick={() => onManageAccess(doc)}
                      >
                        Manage Access
                      </button>
                      <button
                        className="btn-danger"
                        onClick={() => handleDelete(doc)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Users Page (Admin View)
// ---------------------------------------------------------------------------
function UsersAdminView({ user: currentUser }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  const loadUsers = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/users', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleToggleStatus = async (targetUser) => {
    const nextStatus = !targetUser.is_active;
    const actionLabel = nextStatus ? 'enable' : 'disable';

    if (!window.confirm(`Are you sure you want to ${actionLabel} account for "${targetUser.username}"?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/users/${targetUser.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ is_active: nextStatus })
      });

      if (res.ok) {
        setMsg(`User "${targetUser.username}" ${actionLabel}d successfully.`);
        loadUsers();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to update user status');
      }
    } catch (e) {
      alert(e.message);
    }
  };

  return (
    <div>
      <div className="section-actions">
        <h2 className="table-title" style={{ fontSize: '1.25rem' }}>User Management</h2>
      </div>

      {msg && <div className="alert-box alert-success">{msg}</div>}

      <div className="table-card">
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading user accounts...</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Member Since</th>
                <th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td><strong>{u.username}</strong></td>
                  <td>{u.email}</td>
                  <td><span className={`user-badge role-${u.role}`}>{u.role}</span></td>
                  <td>
                    {u.is_active ? (
                      <span style={{ color: '#34d399', fontWeight: 600 }}>Active</span>
                    ) : (
                      <span style={{ color: '#fb7185', fontWeight: 600 }}>Disabled</span>
                    )}
                  </td>
                  <td>{new Date(u.created_at).toLocaleDateString()}</td>
                  <td>
                    <div className="actions-cell">
                      {u.id !== currentUser.id ? (
                        <button
                          className={u.is_active ? 'btn-danger' : 'btn-outline'}
                          onClick={() => handleToggleStatus(u)}
                        >
                          {u.is_active ? 'Disable' : 'Enable'}
                        </button>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>(Current)</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search Documents View
// ---------------------------------------------------------------------------
function SearchDocumentsView({ isAdmin, onManageAccess, onEditDoc }) {
  const [docs, setDocs] = useState([]);
  const [query, setQuery] = useState('');
  const [filterCat, setFilterCat] = useState('All');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/documents', { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => setDocs(data.documents || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = docs.filter((d) => {
    const q = query.toLowerCase();
    const matchesQuery =
      d.title.toLowerCase().includes(q) ||
      (d.description && d.description.toLowerCase().includes(q)) ||
      d.original_filename.toLowerCase().includes(q);
    const matchesCat = filterCat === 'All' || d.category === filterCat;
    return matchesQuery && matchesCat;
  });

  return (
    <div>
      <div className="table-card" style={{ padding: '20px', marginBottom: '24px' }}>
        <div className="form-row">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Search Query</label>
            <input
              type="text"
              className="form-input"
              placeholder="Search by title, description or filename..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Category Filter</label>
            <select
              className="form-select"
              value={filterCat}
              onChange={(e) => setFilterCat(e.target.value)}
            >
              <option value="All">All Categories</option>
              {ALLOWED_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="table-card">
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            No documents matched your search filter.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Owner</th>
                <th>Category</th>
                <th>Access</th>
                <th>Size</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    <strong>{doc.title}</strong>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{doc.original_filename}</div>
                  </td>
                  <td>{doc.owner_username}</td>
                  <td>{doc.category || 'General'}</td>
                  <td>
                    {doc.is_owner ? (
                      <span className="perm-badge perm-owner">Owner</span>
                    ) : doc.my_permission === 'admin_view' ? (
                      <span className="user-badge role-admin">Admin</span>
                    ) : (
                      <span className="perm-badge perm-shared">{doc.my_permission}</span>
                    )}
                  </td>
                  <td>{formatBytes(doc.size_bytes)}</td>
                  <td>
                    <div className="actions-cell">
                      {!isAdmin && (
                        <button
                          className="btn-outline"
                          onClick={() => triggerDownload(doc.id, doc.original_filename)}
                        >
                          Download
                        </button>
                      )}
                      {(doc.is_owner || isAdmin) && (
                        <button
                          className="btn-outline"
                          onClick={() => onManageAccess(doc)}
                        >
                          Access
                        </button>
                      )}
                      {doc.my_permission === 'edit' && (
                        <button
                          className="btn-outline"
                          onClick={() => onEditDoc(doc)}
                        >
                          Edit
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Categories Page View
// ---------------------------------------------------------------------------
function CategoriesView({ isAdmin, onManageAccess, onEditDoc }) {
  const [docs, setDocs] = useState([]);
  const [selectedCat, setSelectedCat] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/documents', { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => setDocs(data.documents || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const counts = {};
  ALLOWED_CATEGORIES.forEach((c) => {
    counts[c] = docs.filter((d) => d.category === c).length;
  });

  const catDocs = selectedCat ? docs.filter((d) => d.category === selectedCat) : [];

  return (
    <div>
      <div className="metrics-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        {ALLOWED_CATEGORIES.map((cat) => (
          <div
            key={cat}
            className={`metric-card ${selectedCat === cat ? 'active' : ''}`}
            onClick={() => setSelectedCat(cat)}
            style={{
              cursor: 'pointer',
              border: selectedCat === cat ? '1px solid #10b981' : undefined,
              background: selectedCat === cat ? 'rgba(16, 185, 129, 0.12)' : undefined
            }}
          >
            <span className="metric-label">{cat}</span>
            <div className="metric-value" style={{ fontSize: '1.5rem' }}>{counts[cat]}</div>
          </div>
        ))}
      </div>

      {selectedCat && (
        <div className="table-card">
          <div className="table-header-row">
            <h2 className="table-title">{selectedCat} Documents</h2>
          </div>

          {catDocs.length === 0 ? (
            <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              No documents in this category.
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Owner</th>
                  <th>Size</th>
                  <th>Date</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {catDocs.map((doc) => (
                  <tr key={doc.id}>
                    <td>
                      <strong>{doc.title}</strong>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{doc.original_filename}</div>
                    </td>
                    <td>{doc.owner_username}</td>
                    <td>{formatBytes(doc.size_bytes)}</td>
                    <td>{new Date(doc.created_at).toLocaleDateString()}</td>
                    <td>
                      <div className="actions-cell">
                        {!isAdmin && (
                          <button
                            className="btn-outline"
                            onClick={() => triggerDownload(doc.id, doc.original_filename)}
                          >
                            Download
                          </button>
                        )}
                        {(doc.is_owner || isAdmin) && (
                          <button
                            className="btn-outline"
                            onClick={() => onManageAccess(doc)}
                          >
                            Access
                          </button>
                        )}
                        {doc.my_permission === 'edit' && (
                          <button
                            className="btn-outline"
                            onClick={() => onEditDoc(doc)}
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Manage Access Modal Component (Owner & Admin)
// ---------------------------------------------------------------------------
function ManageAccessModal({ doc, isAdmin, onClose }) {
  const [grants, setGrants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [newPermission, setNewPermission] = useState('read');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isOwner = doc.is_owner;

  const loadGrants = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch(`/api/documents/${doc.id}/grants`, { credentials: 'include' });
      if (!res.ok) {
        throw new Error('Failed to load grant list');
      }
      const data = await res.json();
      setGrants(data.grants || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGrants();
  }, [doc.id]);

  const handleGrant = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const emailClean = newEmail.trim().toLowerCase();
    if (!emailClean) {
      setError('Please provide recipient email');
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch(`/api/documents/${doc.id}/grants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: emailClean, permission: newPermission })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to grant access');
      }

      setNewEmail('');
      setSuccess(`Access granted to ${emailClean} (${newPermission})`);
      loadGrants();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (grant) => {
    if (!window.confirm(`Revoke ${grant.permission} access for ${grant.email}?`)) return;

    setError('');
    setSuccess('');

    try {
      const res = await fetch(`/api/documents/${doc.id}/grants/${grant.user_id}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to revoke grant');
      }

      setSuccess(`Revoked access for ${grant.email}`);
      loadGrants();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2 className="modal-title">Manage Access: {doc.title}</h2>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>

        {error && <div className="alert-box alert-error">{error}</div>}
        {success && <div className="alert-box alert-success">{success}</div>}

        {/* Owner sees Add Person form. Admin sees list and revoke only */}
        {isOwner && (
          <form onSubmit={handleGrant} style={{ marginBottom: '24px' }}>
            <div className="share-add-row">
              <div style={{ flex: 1 }}>
                <label className="form-label">Add Person (Email)</label>
                <input
                  type="email"
                  className="form-input"
                  placeholder="user@trustvault.local"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  required
                />
              </div>

              <div style={{ width: '120px' }}>
                <label className="form-label">Permission</label>
                <select
                  className="form-select"
                  value={newPermission}
                  onChange={(e) => setNewPermission(e.target.value)}
                >
                  <option value="read">Read</option>
                  <option value="edit">Edit</option>
                </select>
              </div>

              <button
                type="submit"
                className="btn-primary"
                disabled={submitting}
                style={{ height: '42px' }}
              >
                {submitting ? 'Adding...' : 'Grant'}
              </button>
            </div>
          </form>
        )}

        {/* Current Grantees List */}
        <h3 style={{ fontSize: '0.9375rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
          Current Access Grants ({grants.length})
        </h3>

        {loading ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading grants...</div>
        ) : grants.length === 0 ? (
          <div style={{ padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            No external users have been granted access to this document.
          </div>
        ) : (
          <div className="share-list" style={{ maxHeight: '240px', overflowY: 'auto' }}>
            {grants.map((g) => (
              <div key={g.id} className="share-item">
                <div>
                  <div style={{ color: '#fff', fontWeight: 600, fontSize: '0.875rem' }}>{g.username}</div>
                  <div className="share-item-email" style={{ fontSize: '0.75rem' }}>{g.email}</div>
                </div>

                <div className="share-item-meta">
                  <span className={`perm-badge perm-${g.permission}`}>
                    {g.permission}
                  </span>

                  <button
                    className="btn-danger"
                    onClick={() => handleRevoke(g)}
                  >
                    Revoke
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
          <button className="btn-outline" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit Document Modal Component
// ---------------------------------------------------------------------------
function EditDocumentModal({ doc, onClose, onSaved }) {
  const [title, setTitle] = useState(doc.title || '');
  const [description, setDescription] = useState(doc.description || '');
  const [category, setCategory] = useState(doc.category || 'General');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');

    if (!title.trim()) {
      setError('Title cannot be empty');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/documents/${doc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          category
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update document');
      }

      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2 className="modal-title">Edit Document</h2>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>

        {error && <div className="alert-box alert-error">{error}</div>}

        <form onSubmit={handleSave}>
          <div className="form-group">
            <label className="form-label">Title *</label>
            <input
              type="text"
              className="form-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Category</label>
            <select
              className="form-select"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {ALLOWED_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea
              className="form-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
            <button type="button" className="btn-outline" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upload Page View Component
// ---------------------------------------------------------------------------
function UploadPageView({ onUploadSuccess }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('General');
  const [file, setFile] = useState(null);

  const [shares, setShares] = useState([]);
  const [newEmail, setNewEmail] = useState('');
  const [newPermission, setNewPermission] = useState('read');
  const [shareError, setShareError] = useState('');

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [unknownEmails, setUnknownEmails] = useState([]);

  const handleAddRecipient = () => {
    setShareError('');
    const emailClean = newEmail.trim().toLowerCase();

    if (!emailClean) {
      setShareError('Enter recipient email');
      return;
    }
    if (!EMAIL_REGEX.test(emailClean)) {
      setShareError('Please enter a valid email format');
      return;
    }
    if (shares.some((s) => s.email === emailClean)) {
      setShareError('Recipient is already in access list');
      return;
    }

    setShares((prev) => [...prev, { email: emailClean, permission: newPermission }]);
    setNewEmail('');
  };

  const handleRemoveRecipient = (emailToRemove) => {
    setShares((prev) => prev.filter((s) => s.email !== emailToRemove));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setUnknownEmails([]);

    if (!title.trim()) {
      setError('Document title is required');
      return;
    }
    if (!file) {
      setError('Please select a file to upload');
      return;
    }

    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('title', title.trim());
      formData.append('description', description.trim());
      formData.append('category', category);
      formData.append('file', file);

      if (shares.length > 0) {
        formData.append('sharedWith', JSON.stringify(shares));
      }

      const res = await fetch('/api/documents', {
        method: 'POST',
        credentials: 'include',
        body: formData
      });

      const data = await res.json();
      if (!res.ok) {
        if (data.unknownEmails) {
          setUnknownEmails(data.unknownEmails);
        }
        throw new Error(data.error || 'Upload failed');
      }

      onUploadSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="card" style={{ maxWidth: '780px', margin: '0 auto' }}>
      <div className="brand-header" style={{ textAlign: 'left', marginBottom: '20px' }}>
        <h2 style={{ fontSize: '1.25rem', color: '#fff', fontWeight: 700 }}>Upload Document</h2>
        <p className="brand-subtitle">Encrypt and store files in the vault with explicit access permissions</p>
      </div>

      {error && (
        <div className="alert-box alert-error">
          <div>
            <p><strong>Upload Error:</strong> {error}</p>
            {unknownEmails.length > 0 && (
              <p style={{ marginTop: '6px', fontSize: '0.8125rem' }}>
                Unknown emails: {unknownEmails.join(', ')}
              </p>
            )}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">Document Title *</label>
          <input
            type="text"
            className="form-input"
            placeholder="e.g. Q4 Financial Review"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Category</label>
            <select
              className="form-select"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {ALLOWED_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">File * (Max 10 MB)</label>
            <input
              type="file"
              className="form-input"
              onChange={(e) => setFile(e.target.files[0] || null)}
              accept=".pdf,.txt,.docx,.xlsx,.csv,.png,.jpg,.jpeg"
              required
            />
            <span className="inline-hint">Allowed: PDF, TXT, DOCX, XLSX, CSV, PNG, JPG</span>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Description (Optional)</label>
          <textarea
            className="form-textarea"
            placeholder="Summary or context regarding this file..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {/* "Who can access this document" Section - Dark Green Theme */}
        <div className="share-section">
          <div className="share-section-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            <span>Who can access this document</span>
          </div>

          <p className="share-note">
            <strong>Access Note:</strong> Only the people explicitly listed below and you (the uploader) can open this file. Administrators can view document metadata but can never download or read file contents.
          </p>

          <div className="share-add-row">
            <div style={{ flex: 1 }}>
              <label className="form-label" style={{ color: '#a7f3d0' }}>User Email</label>
              <input
                type="email"
                className="form-input"
                placeholder="colleague@trustvault.local"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddRecipient();
                  }
                }}
              />
            </div>

            <div style={{ width: '130px' }}>
              <label className="form-label" style={{ color: '#a7f3d0' }}>Permission</label>
              <select
                className="form-select"
                value={newPermission}
                onChange={(e) => setNewPermission(e.target.value)}
              >
                <option value="read">Read</option>
                <option value="edit">Edit</option>
              </select>
            </div>

            <button
              type="button"
              className="btn-outline"
              onClick={handleAddRecipient}
              style={{ borderColor: 'rgba(16, 185, 129, 0.4)', color: '#6ee7b7', height: '42px' }}
            >
              + Add
            </button>
          </div>

          {shareError && <span className="inline-error" style={{ marginTop: '8px' }}>{shareError}</span>}

          {shares.length > 0 && (
            <div className="share-list">
              {shares.map((s) => (
                <div key={s.email} className="share-item">
                  <span className="share-item-email">{s.email}</span>
                  <div className="share-item-meta">
                    <span className={`perm-badge perm-${s.permission}`}>{s.permission}</span>
                    <button
                      type="button"
                      className="btn-danger"
                      onClick={() => handleRemoveRecipient(s.email)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <button type="submit" className="btn-primary" disabled={uploading}>
          {uploading ? 'Encrypting & Uploading...' : 'Upload to Secure Vault'}
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile Page View
// ---------------------------------------------------------------------------
function MyProfileView({ user, onUserUpdated }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const [editUsername, setEditUsername] = useState('');
  const [editFullName, setEditFullName] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  const loadProfile = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/profile', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setProfile(data);
        setEditUsername(data.username || '');
        setEditFullName(data.full_name || '');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, []);

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    setProfileError('');
    setProfileSuccess('');

    const clean = editUsername.trim();
    if (!USERNAME_REGEX.test(clean)) {
      setProfileError('Username must be 3 to 30 characters (letters, numbers, underscore)');
      return;
    }

    setProfileSaving(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          username: clean,
          full_name: editFullName.trim() || null
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update profile');

      setProfile(data);
      onUserUpdated({ ...user, username: data.username, fullName: data.full_name });
      setProfileSuccess('Profile updated successfully');
    } catch (err) {
      setProfileError(err.message);
    } finally {
      setProfileSaving(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('All password fields are required');
      return;
    }
    if (newPassword.length < 10 || !/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setPasswordError('New password must be at least 10 characters with at least one letter and one number');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New password and confirmation do not match');
      return;
    }

    setPasswordSaving(true);
    try {
      const res = await fetch('/api/profile/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to change password');

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordSuccess('Password changed successfully. Other active sessions revoked.');
    } catch (err) {
      setPasswordError(err.message);
    } finally {
      setPasswordSaving(false);
    }
  };

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading profile...</div>;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
      <div className="card">
        <h2 style={{ fontSize: '1.15rem', color: '#fff', marginBottom: '16px' }}>Account Details</h2>

        {profileError && <div className="alert-box alert-error">{profileError}</div>}
        {profileSuccess && <div className="alert-box alert-success">{profileSuccess}</div>}

        <div style={{ background: 'rgba(7, 13, 10, 0.5)', padding: '14px', borderRadius: '8px', marginBottom: '20px' }}>
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Email</div>
          <div style={{ color: '#fff', fontWeight: 600, marginTop: '2px' }}>{profile?.email}</div>
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '10px' }}>Role</div>
          <div style={{ marginTop: '2px' }}><span className={`user-badge role-${profile?.role}`}>{profile?.role}</span></div>
        </div>

        <form onSubmit={handleUpdateProfile}>
          <div className="form-group">
            <label className="form-label">Username</label>
            <input
              type="text"
              className="form-input"
              value={editUsername}
              onChange={(e) => setEditUsername(e.target.value)}
              required
            />
            <span className="inline-hint">3 to 30 letters, numbers, underscore</span>
          </div>

          <div className="form-group">
            <label className="form-label">Full Name</label>
            <input
              type="text"
              className="form-input"
              value={editFullName}
              onChange={(e) => setEditFullName(e.target.value)}
            />
          </div>

          <button type="submit" className="btn-primary" disabled={profileSaving}>
            {profileSaving ? 'Saving...' : 'Save Profile'}
          </button>
        </form>
      </div>

      <div className="card">
        <h2 style={{ fontSize: '1.15rem', color: '#fff', marginBottom: '16px' }}>Change Password</h2>

        {passwordError && <div className="alert-box alert-error">{passwordError}</div>}
        {passwordSuccess && <div className="alert-box alert-success">{passwordSuccess}</div>}

        <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
          Changing your password immediately invalidates all other active sessions for security.
        </p>

        <form onSubmit={handleChangePassword}>
          <div className="form-group">
            <label className="form-label">Current Password</label>
            <input
              type="password"
              className="form-input"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">New Password</label>
            <input
              type="password"
              className="form-input"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
            <span className="inline-hint">Min 10 characters, at least 1 letter and 1 number</span>
          </div>

          <div className="form-group">
            <label className="form-label">Confirm New Password</label>
            <input
              type="password"
              className="form-input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="btn-primary" disabled={passwordSaving}>
            {passwordSaving ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sign In Form Component
// ---------------------------------------------------------------------------
function SignInForm({ onLoginSuccess, onSwitchToRegister }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Please provide email and password');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');

      onLoginSuccess(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      {error && <div className="alert-box alert-error">{error}</div>}

      <div className="form-group">
        <label className="form-label">Work Email</label>
        <input
          type="email"
          className="form-input"
          placeholder="name@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      <div className="form-group">
        <label className="form-label">Password</label>
        <input
          type="password"
          className="form-input"
          placeholder="••••••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>

      <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={submitting}>
        {submitting ? 'Authenticating...' : 'Sign In'}
      </button>

      <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
        Don't have an account?
        <button type="button" className="btn-link" onClick={onSwitchToRegister}>
          Register
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Register Form Component
// ---------------------------------------------------------------------------
function RegisterForm({ onRegisterSuccess, onSwitchToLogin }) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [touched, setTouched] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState('');

  const isUsernameValid = USERNAME_REGEX.test(username.trim());
  const isEmailValid = EMAIL_REGEX.test(email.trim());
  const isPasswordValid = password.length >= 10 && /[a-zA-Z]/.test(password) && /[0-9]/.test(password);
  const isConfirmValid = confirmPassword.length > 0 && confirmPassword === password;

  const handleRegister = async (e) => {
    e.preventDefault();
    setServerError('');
    setTouched({ username: true, email: true, password: true, confirmPassword: true });

    if (!isUsernameValid || !isEmailValid || !isPasswordValid || !isConfirmValid) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          email: email.trim().toLowerCase(),
          password,
          confirmPassword
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');

      onRegisterSuccess();
    } catch (err) {
      setServerError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleRegister} noValidate>
      {serverError && <div className="alert-box alert-error">{serverError}</div>}

      <div className="form-group">
        <label className="form-label">Username</label>
        <input
          type="text"
          className={`form-input ${touched.username && !isUsernameValid ? 'input-invalid' : ''}`}
          placeholder="e.g. alex_01"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onBlur={() => setTouched((p) => ({ ...p, username: true }))}
          required
        />
        {touched.username && !isUsernameValid ? (
          <span className="inline-error">Must be 3 to 30 characters (letters, numbers, underscore)</span>
        ) : (
          <span className="inline-hint">3 to 30 characters</span>
        )}
      </div>

      <div className="form-group">
        <label className="form-label">Work Email</label>
        <input
          type="email"
          className={`form-input ${touched.email && !isEmailValid ? 'input-invalid' : ''}`}
          placeholder="name@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setTouched((p) => ({ ...p, email: true }))}
          required
        />
        {touched.email && !isEmailValid && (
          <span className="inline-error">Valid email address required</span>
        )}
      </div>

      <div className="form-group">
        <label className="form-label">Password</label>
        <input
          type="password"
          className={`form-input ${touched.password && !isPasswordValid ? 'input-invalid' : ''}`}
          placeholder="••••••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={() => setTouched((p) => ({ ...p, password: true }))}
          required
        />
        {touched.password && !isPasswordValid ? (
          <span className="inline-error">At least 10 characters with at least one letter and one number</span>
        ) : (
          <span className="inline-hint">Min 10 characters, 1 letter, 1 number</span>
        )}
      </div>

      <div className="form-group">
        <label className="form-label">Confirm Password</label>
        <input
          type="password"
          className={`form-input ${touched.confirmPassword && !isConfirmValid ? 'input-invalid' : ''}`}
          placeholder="••••••••••••"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          onBlur={() => setTouched((p) => ({ ...p, confirmPassword: true }))}
          required
        />
        {touched.confirmPassword && !isConfirmValid && (
          <span className="inline-error">Passwords do not match</span>
        )}
      </div>

      <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={submitting}>
        {submitting ? 'Creating account...' : 'Create Account'}
      </button>

      <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
        Already have an account?
        <button type="button" className="btn-link" onClick={onSwitchToLogin}>
          Sign In
        </button>
      </div>
    </form>
  );
}
