// Generated tuple shapes must match the paired genlayer-consensus CON-1042 change.
export const FEES =
  "(uint256 leaderTimeunitsAllocation,uint256 validatorTimeunitsAllocation,uint256 appealRounds,uint256 executionBudgetPerRound,uint256 executionConsumed,uint256 totalMessageFees,uint256[] rotations,uint256 maxPriceGenPerTimeUnit,uint256 storageFeeMaxGasPrice,uint256 receiptFeeMaxGasPrice)";
export const ALLOCATION =
  "(uint8 messageType,bool onAcceptance,uint256 parentIndex,address recipient,bytes32 callKey,uint256 budget,bytes feeParams)";
export const PARAMS = `(address sender,address recipient,uint256 numOfInitialValidators,uint256 maxRotations,uint256 validUntil,uint256 saltNonce,uint256 userValue,${FEES} feesDistribution,bytes txCalldata,${ALLOCATION}[] messageAllocations)`;
export const VAULT_ABI = [
  `function submit(uint256 requestId,address recipient,${PARAMS} params) payable returns(bytes32)`,
  "function admin() view returns(address)",
  "function fundingCaller() view returns(address)",
  "function consensus() view returns(address)",
  "function lifecycle() view returns(address)",
  "function transactions() view returns(address)",
  "function messages() view returns(address)",
  "function admission(address) view returns(uint256 dailyRemaining,uint256 userPending,uint256 recentGlobal,uint256 globalPending,uint256 retryAt)",
  "function requests(uint256) view returns(address recipient,bytes32 txId,bool settled,uint256 reward)",
  "function claimed(address) view returns(uint256)",
  "function credits(address) view returns(uint256)",
  "function totalDistributed() view returns(uint256)",
  "function fundWallet(uint256 requestId,address recipient,uint256 amount)",
  "function reconcile(uint256 requestId)",
  "function cancel(uint256 requestId)",
  "function retryCredit(address recipient)",
  "function claimCredit(address destination)",
  "event Submitted(uint256 indexed requestId,bytes32 indexed txId,address indexed recipient)",
  "event Settled(uint256 indexed requestId,address indexed recipient,uint256 reward)",
];
export const LIFECYCLE_ABI = [
  "function getStoredTransactionStatus(bytes32) view returns(uint8)",
];
export const FEE_ABI = [
  `function calculateRoundFees(${FEES},uint256,uint256) view returns(uint256)`,
];
