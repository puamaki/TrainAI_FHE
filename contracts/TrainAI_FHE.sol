pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract EncryptedAIModelTraining is ZamaEthereumConfig {
    
    struct TrainingData {
        string dataId;
        euint32 encryptedFeature;
        uint256 publicLabel;
        address dataProvider;
        uint256 submissionTime;
        bool isProcessed;
    }
    
    struct ModelWeights {
        euint32 encryptedWeight1;
        euint32 encryptedWeight2;
        uint256 publicBias;
        address trainer;
        uint256 trainingTime;
    }
    
    mapping(string => TrainingData) public trainingDataRegistry;
    mapping(uint256 => ModelWeights) public modelWeightsRegistry;
    
    string[] public dataIds;
    uint256[] public modelVersions;
    
    event DataSubmitted(string indexed dataId, address indexed dataProvider);
    event ModelTrained(uint256 indexed modelVersion, address indexed trainer);
    event DataProcessed(string indexed dataId, uint256 indexed modelVersion);

    constructor() ZamaEthereumConfig() {
    }
    
    function submitEncryptedData(
        string calldata dataId,
        externalEuint32 encryptedFeature,
        bytes calldata inputProof,
        uint256 publicLabel
    ) external {
        require(bytes(trainingDataRegistry[dataId].dataId).length == 0, "Data ID already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedFeature, inputProof)), "Invalid encrypted input");

        trainingDataRegistry[dataId] = TrainingData({
            dataId: dataId,
            encryptedFeature: FHE.fromExternal(encryptedFeature, inputProof),
            publicLabel: publicLabel,
            dataProvider: msg.sender,
            submissionTime: block.timestamp,
            isProcessed: false
        });
        
        FHE.allowThis(trainingDataRegistry[dataId].encryptedFeature);
        FHE.makePubliclyDecryptable(trainingDataRegistry[dataId].encryptedFeature);
        
        dataIds.push(dataId);
        emit DataSubmitted(dataId, msg.sender);
    }
    
    function trainModel(
        uint256 modelVersion,
        externalEuint32 encryptedWeight1,
        bytes calldata weight1Proof,
        externalEuint32 encryptedWeight2,
        bytes calldata weight2Proof,
        uint256 publicBias
    ) external {
        require(modelWeightsRegistry[modelVersion].trainer == address(0), "Model version already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedWeight1, weight1Proof)), "Invalid weight1 encryption");
        require(FHE.isInitialized(FHE.fromExternal(encryptedWeight2, weight2Proof)), "Invalid weight2 encryption");

        modelWeightsRegistry[modelVersion] = ModelWeights({
            encryptedWeight1: FHE.fromExternal(encryptedWeight1, weight1Proof),
            encryptedWeight2: FHE.fromExternal(encryptedWeight2, weight2Proof),
            publicBias: publicBias,
            trainer: msg.sender,
            trainingTime: block.timestamp
        });
        
        FHE.allowThis(modelWeightsRegistry[modelVersion].encryptedWeight1);
        FHE.allowThis(modelWeightsRegistry[modelVersion].encryptedWeight2);
        FHE.makePubliclyDecryptable(modelWeightsRegistry[modelVersion].encryptedWeight1);
        FHE.makePubliclyDecryptable(modelWeightsRegistry[modelVersion].encryptedWeight2);
        
        modelVersions.push(modelVersion);
        emit ModelTrained(modelVersion, msg.sender);
    }
    
    function processTrainingData(
        string calldata dataId,
        uint256 modelVersion,
        bytes memory computationProof
    ) external {
        require(bytes(trainingDataRegistry[dataId].dataId).length > 0, "Data does not exist");
        require(modelWeightsRegistry[modelVersion].trainer != address(0), "Model version does not exist");
        require(!trainingDataRegistry[dataId].isProcessed, "Data already processed");

        euint32 memory encryptedFeature = trainingDataRegistry[dataId].encryptedFeature;
        euint32 memory encryptedWeight1 = modelWeightsRegistry[modelVersion].encryptedWeight1;
        euint32 memory encryptedWeight2 = modelWeightsRegistry[modelVersion].encryptedWeight2;
        
        euint32 memory encryptedResult = FHE.add(
            FHE.mul(encryptedFeature, encryptedWeight1),
            FHE.mul(encryptedFeature, encryptedWeight2)
        );
        
        FHE.checkComputation(
            abi.encodePacked(
                FHE.toBytes32(encryptedFeature),
                FHE.toBytes32(encryptedWeight1),
                FHE.toBytes32(encryptedWeight2)
            ),
            FHE.toBytes32(encryptedResult),
            computationProof
        );
        
        trainingDataRegistry[dataId].isProcessed = true;
        emit DataProcessed(dataId, modelVersion);
    }
    
    function getTrainingData(string calldata dataId) external view returns (
        euint32 encryptedFeature,
        uint256 publicLabel,
        address dataProvider,
        uint256 submissionTime,
        bool isProcessed
    ) {
        require(bytes(trainingDataRegistry[dataId].dataId).length > 0, "Data does not exist");
        TrainingData storage data = trainingDataRegistry[dataId];
        
        return (
            data.encryptedFeature,
            data.publicLabel,
            data.dataProvider,
            data.submissionTime,
            data.isProcessed
        );
    }
    
    function getModelWeights(uint256 modelVersion) external view returns (
        euint32 encryptedWeight1,
        euint32 encryptedWeight2,
        uint256 publicBias,
        address trainer,
        uint256 trainingTime
    ) {
        require(modelWeightsRegistry[modelVersion].trainer != address(0), "Model version does not exist");
        ModelWeights storage weights = modelWeightsRegistry[modelVersion];
        
        return (
            weights.encryptedWeight1,
            weights.encryptedWeight2,
            weights.publicBias,
            weights.trainer,
            weights.trainingTime
        );
    }
    
    function getAllDataIds() external view returns (string[] memory) {
        return dataIds;
    }
    
    function getAllModelVersions() external view returns (uint256[] memory) {
        return modelVersions;
    }
    
    function isAvailable() public pure returns (bool) {
        return true;
    }
}


