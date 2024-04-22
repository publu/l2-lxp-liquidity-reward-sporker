import fs from "fs";
import { write } from "fast-csv";
import Web3 from "web3";

import vaultAbi from './vault.json';

type OutputDataSchemaRow = {
    block_number: number;
    timestamp: number;
    user_address: string;
    token_address: string;
    token_balance: number;
    token_symbol: string;
    usd_price: number;
};

const LINEA_RPC = "https://rpc.linea.build";
const STUDIO_GRAPH_URL = "https://api.studio.thegraph.com/query/54537/linea-qidao-vaults/version/latest";

const MAI_COLLATERAL_QUERY = `
    query DepositsBTC {
        depositCollaterals(first: 1000) {
            id
            vaultID
            blockNumber
            blockTimestamp
        }
    }
    query WithdrawalsBTC {
        withdrawCollaterals(first: 1000, skip: 1000) {
            id
            vaultID
            blockNumber
            blockTimestamp
        }
    }
    query DepositsMPETH {
        mpethvaultDepositCollaterals(first: 1000) {
            id
            vaultID
            blockNumber
            blockTimestamp
        }
    }
    query DepositsMPETH {
        mpethvaultWithdrawCollaterals(first: 1000) {
            id
            vaultID
            blockNumber
            blockTimestamp
        }
    }

    query DepositsWETH {
        wethvaultDepositCollaterals(first: 1000) {
            id
            vaultID
            blockNumber
            blockTimestamp
        }
    }
    query DepositsWETH {
        mpethvaultWithdrawCollaterals(first: 1000) {
            id
            vaultID
            blockNumber
            blockTimestamp
        }
    }
`;

const post = async (url: string, data: any): Promise<any> => {
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify(data),
    });
    return await response.json();
};

const getLatestBlockNumberAndTimestamp = async () => {
    const data = await post(LINEA_RPC, {
        jsonrpc: "2.0",
        method: "eth_getBlockByNumber",
        params: ["latest", false],
        id: 1,
    });
    const blockNumber = parseInt(data.result.number);
    const blockTimestamp = parseInt(data.result.timestamp);
    return { blockNumber, blockTimestamp };
};

const readContractData = async (contractAddress: string, blockNumber: number, methodName: string, params: any[] = []) => {
    const web3 = new Web3(LINEA_RPC);
    const contract = new web3.eth.Contract(vaultAbi, contractAddress);
    try {
        const data = await contract.methods[methodName](...params).call({}, blockNumber);
        return data;
    } catch (error) {
        console.error(`Error reading data from contract at ${contractAddress} using method ${methodName} at block ${blockNumber}`, error);
        throw error;
    }
};

const getTotalSupply = async (contractAddress: string, blockNumber: number): Promise<number> => {
    const methodName = "totalSupply";
    try {
        const totalSupply = await readContractData(contractAddress, blockNumber, methodName);
        console.log(`Total Supply: ${totalSupply}`);
        return Number(totalSupply);
    } catch (error) {
        console.error("Failed to get total supply", error);
        throw error;
    }
};


interface VaultData {
    [vaultId: number]: {
        accumulatedVaultDebt: string;
        ownerOfVault: string;
    };
}

async function getVaultsAndBorrowed(contractAddress: string, blockNumber: number): Promise<VaultData> {
    const totalSupply = await getTotalSupply(contractAddress, blockNumber);
    const vaultsAndBorrowed: VaultData = {};
    for (let vaultId = 1; vaultId <= totalSupply; vaultId++) {
        const exists = await readContractData(contractAddress, blockNumber, "exists", [vaultId]);
        if (exists) {
            const accumulatedVaultDebt = await readContractData(contractAddress, blockNumber, "accumulatedVaultDebt", [vaultId]) as unknown as string;
            const ownerOfVault = await readContractData(contractAddress, blockNumber, "ownerOf", [vaultId]) as unknown as string;
            vaultsAndBorrowed[vaultId] = { accumulatedVaultDebt, ownerOfVault };
        }
    }
    return vaultsAndBorrowed;
}

interface BlockData {
    blockNumber: number;
    blockTimestamp: number;
}

export const getUserTVLByBlock = async (blocks: BlockData): Promise<OutputDataSchemaRow[]> => {
    const { blockNumber, blockTimestamp } = blocks;
    const csvRows: OutputDataSchemaRow[] = [];
    const maiAddress = "0xf3B001D64C656e30a62fbaacA003B1336b4ce12A";

    // vaults
    const btcAddress = "0x8ab01c5ee3422099156ab151eecb83c095626599"; // btc
    const wethAddress = "0x7f9dd991e8fd0cbb52cb8eb35dd35c474a9a7a70";
    const mpethAddress = "0x60d133c666919B54a3254E0d3F14332cB783B733";

    const tokenAddresses = [wethAddress, btcAddress, mpethAddress];
    const tokenSymbols = ["WETH", "BTC", "MPETH"];
    for (let i = 0; i < tokenAddresses.length; i++) {
        const vaultsAndBorrowed = await getVaultsAndBorrowed(tokenAddresses[i], blockNumber);
        for (const [vaultId, data] of Object.entries(vaultsAndBorrowed)) {
            csvRows.push({
                block_number: blockNumber,
                timestamp: blockTimestamp,
                user_address: data.ownerOfVault,
                token_address: tokenAddresses[i],
                token_balance: data.accumulatedVaultDebt,
                token_symbol: "MAI",
                usd_price: parseFloat((parseFloat(data.accumulatedVaultDebt) / 1e18).toFixed(2)) // Convert to dollars with 2 decimal places
            });
        }
    }
    return csvRows;
};


const testTVLCall = async () => {
    const testBlockData: BlockData = {
        blockNumber: 3041467,
        blockTimestamp: 1711023841 // Current timestamp in seconds
    };

    try {
        const tvlData = await getUserTVLByBlock(testBlockData);
        console.log("Test TVL Data:", tvlData);
    } catch (error) {
        console.error("Error fetching TVL data:", error);
    }
};

testTVLCall();
