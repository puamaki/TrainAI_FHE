import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface TrainingTask {
  id: string;
  name: string;
  encryptedValue: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  timestamp: number;
  creator: string;
  isVerified: boolean;
  decryptedValue: number;
}

interface TrainingStats {
  totalTasks: number;
  verifiedTasks: number;
  avgAccuracy: number;
  activeModels: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<TrainingTask[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newTaskData, setNewTaskData] = useState({ name: "", accuracy: "", epoch: "", description: "" });
  const [selectedTask, setSelectedTask] = useState<TrainingTask | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [operationHistory, setOperationHistory] = useState<string[]>([]);
  const [stats, setStats] = useState<TrainingStats>({ totalTasks: 0, verifiedTasks: 0, avgAccuracy: 0, activeModels: 0 });

  const { initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevm = async () => {
      if (isConnected && !isInitialized) {
        try {
          await initialize();
          addToHistory("FHEVM initialized successfully");
        } catch (error) {
          console.error('FHEVM init failed:', error);
        }
      }
    };
    initFhevm();
  }, [isConnected, isInitialized, initialize]);

  useEffect(() => {
    const loadData = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      try {
        await loadTasks();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Load failed:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [isConnected]);

  const addToHistory = (message: string) => {
    setOperationHistory(prev => [`${new Date().toLocaleTimeString()}: ${message}`, ...prev.slice(0, 9)]);
  };

  const loadTasks = async () => {
    if (!isConnected) return;
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const tasksList: TrainingTask[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          tasksList.push({
            id: businessId,
            name: businessData.name,
            encryptedValue: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading task:', e);
        }
      }
      
      setTasks(tasksList);
      updateStats(tasksList);
      addToHistory(`Loaded ${tasksList.length} training tasks`);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load tasks" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const updateStats = (tasksList: TrainingTask[]) => {
    const totalTasks = tasksList.length;
    const verifiedTasks = tasksList.filter(t => t.isVerified).length;
    const avgAccuracy = tasksList.length > 0 
      ? tasksList.reduce((sum, t) => sum + t.publicValue1, 0) / tasksList.length 
      : 0;
    
    setStats({
      totalTasks,
      verifiedTasks,
      avgAccuracy,
      activeModels: tasksList.filter(t => t.publicValue2 > 0).length
    });
  };

  const createTask = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingTask(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating AI training task with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Contract not available");
      
      const accuracyValue = parseInt(newTaskData.accuracy) || 0;
      const businessId = `task-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, accuracyValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newTaskData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        accuracyValue,
        parseInt(newTaskData.epoch) || 0,
        newTaskData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Training task created!" });
      addToHistory(`Created new training task: ${newTaskData.name}`);
      
      await loadTasks();
      setShowCreateModal(false);
      setNewTaskData({ name: "", accuracy: "", epoch: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected") 
        ? "Transaction rejected" 
        : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
    } finally { 
      setCreatingTask(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified" });
        addToHistory(`Data verified for task: ${businessData.name}`);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      await loadTasks();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted successfully!" });
      addToHistory(`Decrypted data for task: ${businessData.name}`);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified" });
        await loadTasks();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const handleCheckAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (contract) {
        const available = await contract.isAvailable();
        if (available) {
          setTransactionStatus({ visible: true, status: "success", message: "FHE system is available" });
          addToHistory("Checked FHE system availability - OK");
        }
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
    }
  };

  const renderStatsDashboard = () => {
    return (
      <div className="stats-grid">
        <div className="stat-card gold-card">
          <div className="stat-icon">🤖</div>
          <div className="stat-content">
            <h3>Total Tasks</h3>
            <div className="stat-value">{stats.totalTasks}</div>
            <div className="stat-trend">AI Models</div>
          </div>
        </div>
        
        <div className="stat-card silver-card">
          <div className="stat-icon">🔐</div>
          <div className="stat-content">
            <h3>Verified Data</h3>
            <div className="stat-value">{stats.verifiedTasks}</div>
            <div className="stat-trend">FHE Protected</div>
          </div>
        </div>
        
        <div className="stat-card bronze-card">
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <h3>Avg Accuracy</h3>
            <div className="stat-value">{stats.avgAccuracy.toFixed(1)}%</div>
            <div className="stat-trend">Encrypted Metrics</div>
          </div>
        </div>
        
        <div className="stat-card copper-card">
          <div className="stat-icon">⚡</div>
          <div className="stat-content">
            <h3>Active Training</h3>
            <div className="stat-value">{stats.activeModels}</div>
            <div className="stat-trend">In Progress</div>
          </div>
        </div>
      </div>
    );
  };

  const renderAccuracyChart = (task: TrainingTask) => {
    const accuracy = task.isVerified ? task.decryptedValue : task.publicValue1;
    return (
      <div className="accuracy-chart">
        <div className="chart-header">
          <h4>Model Accuracy</h4>
          <span className="accuracy-value">{accuracy}%</span>
        </div>
        <div className="chart-bar">
          <div 
            className="bar-fill" 
            style={{ width: `${Math.min(100, accuracy)}%` }}
          ></div>
        </div>
        <div className="chart-labels">
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header metal-header">
          <div className="logo">
            <div className="logo-icon">🔐</div>
            <h1>隐私AI训练平台</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content metal-panel">
            <div className="connection-icon">🤖</div>
            <h2>连接钱包开始隐私AI训练</h2>
            <p>使用FHE同态加密技术保护您的AI模型数据隐私</p>
            <div className="connection-steps">
              <div className="step">
                <span className="step-number">1</span>
                <p>连接您的加密货币钱包</p>
              </div>
              <div className="step">
                <span className="step-number">2</span>
                <p>初始化FHE加密系统</p>
              </div>
              <div className="step">
                <span className="step-number">3</span>
                <p>开始安全的AI模型训练</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner metal-spinner"></div>
        <p>初始化FHE加密系统...</p>
        <p className="loading-note">正在准备同态加密环境</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner metal-spinner"></div>
      <p>加载隐私AI训练平台...</p>
    </div>
  );

  return (
    <div className="app-container metal-theme">
      <header className="app-header metal-header">
        <div className="logo">
          <div className="logo-icon">🔐</div>
          <h1>隐私AI训练平台</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={handleCheckAvailability}
            className="check-btn metal-btn"
          >
            检查系统状态
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn metal-btn"
          >
            + 新建训练任务
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="dashboard-section">
          <h2>FHE隐私AI训练看板</h2>
          {renderStatsDashboard()}
        </div>
        
        <div className="content-grid">
          <div className="tasks-section">
            <div className="section-header">
              <h3>AI训练任务列表</h3>
              <button onClick={loadTasks} className="refresh-btn metal-btn">
                刷新列表
              </button>
            </div>
            
            <div className="tasks-list">
              {tasks.length === 0 ? (
                <div className="no-tasks metal-panel">
                  <p>暂无训练任务</p>
                  <button 
                    className="create-btn metal-btn" 
                    onClick={() => setShowCreateModal(true)}
                  >
                    创建第一个任务
                  </button>
                </div>
              ) : tasks.map((task, index) => (
                <div 
                  className={`task-item metal-panel ${selectedTask?.id === task.id ? "selected" : ""} ${task.isVerified ? "verified" : ""}`} 
                  key={index}
                  onClick={() => setSelectedTask(task)}
                >
                  <div className="task-header">
                    <div className="task-title">{task.name}</div>
                    <div className={`task-status ${task.isVerified ? "verified" : "pending"}`}>
                      {task.isVerified ? "✅ 已验证" : "🔓 待验证"}
                    </div>
                  </div>
                  <div className="task-meta">
                    <span>准确率: {task.publicValue1}%</span>
                    <span>训练轮次: {task.publicValue2}</span>
                    <span>创建: {new Date(task.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                  <div className="task-creator">创建者: {task.creator.substring(0, 6)}...{task.creator.substring(38)}</div>
                </div>
              ))}
            </div>
          </div>
          
          <div className="sidebar-section">
            <div className="history-panel metal-panel">
              <h3>操作历史</h3>
              <div className="history-list">
                {operationHistory.map((entry, index) => (
                  <div key={index} className="history-entry">
                    {entry}
                  </div>
                ))}
                {operationHistory.length === 0 && (
                  <div className="no-history">暂无操作记录</div>
                )}
              </div>
            </div>
            
            <div className="info-panel metal-panel">
              <h3>FHE加密流程</h3>
              <div className="flow-steps">
                <div className="flow-step">
                  <div className="step-number">1</div>
                  <div className="step-content">
                    <strong>数据加密</strong>
                    <p>AI训练数据使用FHE加密</p>
                  </div>
                </div>
                <div className="flow-step">
                  <div className="step-number">2</div>
                  <div className="step-content">
                    <strong>同态训练</strong>
                    <p>在加密数据上直接进行计算</p>
                  </div>
                </div>
                <div className="flow-step">
                  <div className="step-number">3</div>
                  <div className="step-content">
                    <strong>结果验证</strong>
                    <p>解密并验证训练结果</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateTask 
          onSubmit={createTask} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingTask} 
          taskData={newTaskData} 
          setTaskData={setNewTaskData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedTask && (
        <TaskDetailModal 
          task={selectedTask} 
          onClose={() => setSelectedTask(null)} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedTask.id)}
          renderAccuracyChart={renderAccuracyChart}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content metal-panel">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner metal-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateTask: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  taskData: any;
  setTaskData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, taskData, setTaskData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'accuracy') {
      const intValue = value.replace(/[^\d]/g, '');
      setTaskData({ ...taskData, [name]: intValue });
    } else {
      setTaskData({ ...taskData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-task-modal metal-panel">
        <div className="modal-header">
          <h2>新建AI训练任务</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice metal-notice">
            <strong>FHE同态加密保护</strong>
            <p>模型准确率将使用FHE加密（仅支持整数）</p>
          </div>
          
          <div className="form-group">
            <label>任务名称 *</label>
            <input 
              type="text" 
              name="name" 
              value={taskData.name} 
              onChange={handleChange} 
              placeholder="输入训练任务名称..." 
              className="metal-input"
            />
          </div>
          
          <div className="form-group">
            <label>模型准确率 (整数) *</label>
            <input 
              type="number" 
              name="accuracy" 
              value={taskData.accuracy} 
              onChange={handleChange} 
              placeholder="输入准确率百分比..." 
              step="1"
              min="0"
              max="100"
              className="metal-input"
            />
            <div className="data-type-label">FHE加密整数</div>
          </div>
          
          <div className="form-group">
            <label>训练轮次 *</label>
            <input 
              type="number" 
              min="1" 
              name="epoch" 
              value={taskData.epoch} 
              onChange={handleChange} 
              placeholder="输入训练轮次..." 
              className="metal-input"
            />
            <div className="data-type-label">公开数据</div>
          </div>
          
          <div className="form-group">
            <label>任务描述</label>
            <textarea 
              name="description" 
              value={taskData.description} 
              onChange={handleChange} 
              placeholder="输入任务描述..." 
              className="metal-textarea"
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn metal-btn">取消</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !taskData.name || !taskData.accuracy || !taskData.epoch} 
            className="submit-btn metal-btn"
          >
            {creating || isEncrypting ? "加密并创建中..." : "创建任务"}
          </button>
        </div>
      </div>
    </div>
  );
};

const TaskDetailModal: React.FC<{
  task: TrainingTask;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  renderAccuracyChart: (task: TrainingTask) => JSX.Element;
}> = ({ task, onClose, isDecrypting, decryptData, renderAccuracyChart }) => {
  const handleDecrypt = async () => {
    await decryptData();
  };

  return (
    <div className="modal-overlay">
      <div className="task-detail-modal metal-panel">
        <div className="modal-header">
          <h2>训练任务详情</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="task-info">
            <div className="info-item">
              <span>任务名称:</span>
              <strong>{task.name}</strong>
            </div>
            <div className="info-item">
              <span>创建者:</span>
              <strong>{task.creator.substring(0, 6)}...{task.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>创建时间:</span>
              <strong>{new Date(task.timestamp * 1000).toLocaleString()}</strong>
            </div>
            <div className="info-item">
              <span>训练轮次:</span>
              <strong>{task.publicValue2}</strong>
            </div>
            <div className="info-item">
              <span>任务描述:</span>
              <strong>{task.description}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>加密模型数据</h3>
            
            <div className="data-row">
              <div className="data-label">模型准确率:</div>
              <div className="data-value">
                {task.isVerified ? 
                  `${task.decryptedValue}% (链上已验证)` : 
                  "🔒 FHE加密整数"
                }
              </div>
              <button 
                className={`decrypt-btn metal-btn ${task.isVerified ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? "🔓 验证中..." : task.isVerified ? "✅ 已验证" : "🔓 验证解密"}
              </button>
            </div>
            
            <div className="fhe-info metal-notice">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE同态加密验证</strong>
                <p>点击"验证解密"进行离线解密和链上验证</p>
              </div>
            </div>
          </div>
          
          {(task.isVerified) && (
            <div className="analysis-section">
              <h3>模型性能分析</h3>
              {renderAccuracyChart(task)}
              
              <div className="decrypted-values">
                <div className="value-item">
                  <span>准确率:</span>
                  <strong>{task.decryptedValue}%</strong>
                  <span className={`data-badge ${task.isVerified ? 'verified' : 'local'}`}>
                    {task.isVerified ? '链上已验证' : '本地解密'}
                  </span>
                </div>
                <div className="value-item">
                  <span>训练轮次:</span>
                  <strong>{task.publicValue2}</strong>
                  <span className="data-badge public">公开数据</span>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn metal-btn">关闭</button>
          {!task.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn metal-btn"
            >
              {isDecrypting ? "链上验证中..." : "链上验证"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


