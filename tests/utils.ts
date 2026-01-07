import * as anchor from '@coral-xyz/anchor';
import { AnchorProvider, BN, Idl, Program, setProvider, Wallet } from '@coral-xyz/anchor';
import { createAssociatedTokenAccount, createMint, mintTo } from '@solana/spl-token';
import { utf8 } from '@coral-xyz/anchor/dist/cjs/utils/bytes';
import { Connection, PublicKey, Signer } from '@solana/web3.js';
import { Context } from 'mocha';
import { expect } from 'chai';
import { createInterface } from 'readline';
import { JobsProgram, PoolsProgram, RewardsProgram, StakingProgram } from './types/nosana';
import { constants } from './contstants';
import MintKey = require('./keys/devr1BGQndEW5k5zfvG5FsLyZv1Ap73vNgAHcQ9sUVP.json');
import DummyKey = require('./keys/dumQVNHZ1KNcLmzjMaDPEA5vFCzwHEEcQmZ8JHmmCNH.json');
import _ = require('lodash');

// Light Protocol imports
import {
  bn,
  CompressedAccountWithMerkleContext,
  createRpc,
  defaultTestStateTreeAccounts,
  deriveAddress,
  deriveAddressSeed,
  PackedAccounts,
  Rpc,
  SystemAccountMetaConfig,
} from '@lightprotocol/stateless.js';

// Custom address tree for nosana stake accounts (must match program's ALLOWED_ADDRESS_TREE)
const NOSANA_ADDRESS_TREE = new PublicKey('amt2kaJA14v3urZbZvnc5v2np8jqvc4Z8zDep5wbtzx');
const NOSANA_ADDRESS_QUEUE = new PublicKey('amt2kaJA14v3urZbZvnc5v2np8jqvc4Z8zDep5wbtzx');

/**
 *
 * @param address
 */
async function setupProgram(address: PublicKey) {
  const idl = (await Program.fetchIdl(address.toString())) as Idl;
  return new Program(idl, address);
}

/**
 *
 * @param NosanaProgram
 */
async function setupAnchorAndPrograms() {
  // anchor
  const provider = AnchorProvider.env();
  setProvider(provider);
  const wallet = provider.wallet as Wallet;

  const programs = {
    staking: (await setupProgram(constants.stakingProgramAddress)) as unknown as StakingProgram,
    rewards: (await setupProgram(constants.rewardsProgramAddress)) as unknown as RewardsProgram,
    pools: (await setupProgram(constants.poolsProgramAddress)) as unknown as PoolsProgram,
    jobs: (await setupProgram(constants.jobsProgramAddress)) as unknown as JobsProgram,
  };

  return {
    provider,
    wallet,
    programs,
  };
}

/**
 *
 * @param provider
 * @param wallet
 */
async function getTokenBalance(provider: AnchorProvider, wallet: PublicKey) {
  return parseInt((await provider.connection.getTokenAccountBalance(wallet)).value.amount);
}

/**
 *
 */
function getDummyKey() {
  return anchor.web3.Keypair.fromSecretKey(new Uint8Array(DummyKey));
}

/**
 *
 * @param connection
 * @param payer
 * @param authority
 */
async function createNosMint(connection: Connection, payer: Signer, authority: PublicKey) {
  return await createMint(
    connection,
    payer,
    authority,
    null,
    6,
    anchor.web3.Keypair.fromSecretKey(new Uint8Array(MintKey)),
  );
}

/**
 *
 * @param users
 * @param f
 */
async function mapUsers(users, f) {
  return await Promise.all(_.map(users, f));
}

/**
 *
 * @param buffer
 */
function buf2hex(buffer: Iterable<number>) {
  // buffer is an ArrayBuffer
  return [...new Uint8Array(buffer)].map((x) => x.toString().padStart(2, '0')).join('');
}

/**
 *
 * @param seeds
 * @param programId
 */
async function pda(seeds: Array<Buffer | Uint8Array>, programId: PublicKey) {
  return (await PublicKey.findProgramAddress(seeds, programId))[0];
}

/**
 *
 * @param duration
 * @param amount
 */
function calculateXnos(duration: number, amount: number) {
  const xnosDiv = ((365 * 24 * 60 * 60) / 12) * 4;
  return Math.floor((duration / xnosDiv + 1) * amount);
}

/**
 *
 * @param seconds
 */
const sleep = (seconds: number) => new Promise((res) => setTimeout(res, seconds * 1e3));

/**
 *
 */
const getTimestamp = () => Math.floor(Date.now() / 1e3);

/**
 *
 */
const now = function () {
  return Math.floor(Date.now() / 1e3);
};

/**
 *
 * @param location
 * @param data
 */
const solanaExplorer = function (location: string, data = false) {
  let url = `https://explorer.solana.com/${location.length >= 80 ? 'tx' : 'address'}/${location}`;
  if (data) url += '/anchor-account';
  if (process.env.ANCHOR_PROVIDER_URL.toLowerCase().includes('devnet')) url += '?cluster=devnet';
  return url;
};

/**
 *
 * @param question
 */
async function ask(question): Promise<boolean> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  readline.setPrompt(`${question} [yes/no]\n`);
  readline.prompt();

  return new Promise((resolve) => {
    let userInput;
    readline.on('line', (input) => {
      userInput = input;
      readline.close();
    });

    readline.on('close', () => {
      resolve(userInput === 'yes');
    });
  });
}

/**
 *
 * @param mochaContext
 * @param stakePubkey - compressed stake account address
 * @param fee
 * @param reflection
 */
async function updateRewards(
  mochaContext: Context,
  stakePubkey: PublicKey,
  fee = new anchor.BN(0),
  reflection = new anchor.BN(0),
) {
  // Fetch stake from compressed account
  const stake = await fetchCompressedStake(mochaContext.rpc, stakePubkey, mochaContext.coder);
  if (!stake) {
    throw new Error('Compressed stake account not found in updateRewards');
  }
  const stats = await mochaContext.rewardsProgram.account.reflectionAccount.fetch(mochaContext.accounts.reflection);

  let amount = 0;
  if (!reflection.eqn(0)) {
    amount = reflection.div(mochaContext.total.rate).sub(stake.xnos).toNumber();
    mochaContext.total.xnos.isub(stake.xnos.add(new BN(amount)));
    mochaContext.total.reflection.isub(reflection);
  }

  if (!fee.eqn(0)) {
    mochaContext.total.xnos.iadd(fee);
    mochaContext.total.rate = mochaContext.total.reflection.div(mochaContext.total.xnos);
  } else {
    mochaContext.total.xnos.iadd(stake.xnos);
    mochaContext.total.reflection.iadd(stake.xnos.mul(mochaContext.total.rate));
  }

  expect(stats.rate.toString()).to.equal(mochaContext.total.rate.toString(), 'Rate error');
  expect(stats.totalXnos.toString()).to.equal(mochaContext.total.xnos.toString(), 'Total XNOS error');
  expect(stats.totalReflection.toString()).to.equal(mochaContext.total.reflection.toString(), 'Total reflection error');

  return amount;
}

async function mintNosTo(mochaContext: Context, to: PublicKey, amount: number | bigint) {
  await mintTo(mochaContext.connection, mochaContext.payer, mochaContext.mint, to, mochaContext.payer, amount);
}

/**
 *
 * @param mochaContext
 */
async function setupSolanaUser(mochaContext: Context) {
  const user = anchor.web3.Keypair.generate();
  const publicKey = user.publicKey;
  const wallet = new anchor.Wallet(user);
  const provider = new anchor.AnchorProvider(mochaContext.connection, wallet, {});

  // fund SOL
  await mochaContext.connection.confirmTransaction(
    await mochaContext.connection.requestAirdrop(publicKey, anchor.web3.LAMPORTS_PER_SOL),
  );
  // fund NOS
  const ata = await createAssociatedTokenAccount(
    mochaContext.connection,
    mochaContext.payer,
    mochaContext.mint,
    publicKey,
  );
  // fund user
  await mintNosTo(mochaContext, ata, mochaContext.constants.userSupply);

  // return user object
  return {
    user,
    publicKey,
    ata,
    provider,
    wallet,
    balance: mochaContext.constants.userSupply,
    // pdas
    project: await pda([utf8.encode('project'), publicKey.toBuffer()], mochaContext.jobsProgram.programId),
    // stake is now a compressed account address, not a PDA
    stake: deriveStakeAddress(mochaContext.mint, publicKey, mochaContext.stakingProgram.programId),
    reward: await pda([utf8.encode('reward'), publicKey.toBuffer()], mochaContext.rewardsProgram.programId),
    vault: await pda(
      [utf8.encode('vault'), mochaContext.mint.toBuffer(), publicKey.toBuffer()],
      mochaContext.stakingProgram.programId,
    ),
    // undefined
    job: undefined,
    ataNft: undefined,
    metadataAddress: undefined,
  };
}

async function getUsers(mochaContext: Context, amount: number) {
  return await Promise.all(
    _.map(new Array(amount), async () => {
      return await setupSolanaUser(mochaContext);
    }),
  );
}

// ============================================================================
// Light Protocol Utilities for Compressed Stake Accounts
// ============================================================================

/**
 * Create Light Protocol RPC client for local test validator
 */
function createLightRpc(): Rpc {
  return createRpc('http://127.0.0.1:8899', 'http://127.0.0.1:8784', 'http://127.0.0.1:3001', {
    commitment: 'confirmed',
  });
}

/**
 * Derive compressed stake account address
 */
function deriveStakeAddress(mint: PublicKey, authority: PublicKey, programId: PublicKey): PublicKey {
  const seed = deriveAddressSeed([Buffer.from('stake'), mint.toBuffer(), authority.toBuffer()], programId);
  return deriveAddress(seed, NOSANA_ADDRESS_TREE);
}

/**
 * Prepare proof and accounts for creating a new compressed stake account
 */
async function prepareStakeCreate(rpc: Rpc, stakeAddress: PublicKey, programId: PublicKey) {
  const { merkleTree } = defaultTestStateTreeAccounts();

  const proofRpcResult = await rpc.getValidityProofV0(
    [],
    [
      {
        tree: NOSANA_ADDRESS_TREE,
        queue: NOSANA_ADDRESS_QUEUE,
        address: bn(stakeAddress.toBytes()),
      },
    ],
  );

  const systemAccountConfig = SystemAccountMetaConfig.new(programId);
  const remainingAccounts = PackedAccounts.newWithSystemAccounts(systemAccountConfig);

  const addressMerkleTreePubkeyIndex = remainingAccounts.insertOrGet(NOSANA_ADDRESS_TREE);
  const addressQueuePubkeyIndex = remainingAccounts.insertOrGet(NOSANA_ADDRESS_QUEUE);
  const outputMerkleTreeIndex = remainingAccounts.insertOrGet(merkleTree);

  const proof = { 0: proofRpcResult.compressedProof };
  const addressTreeInfo = {
    addressMerkleTreePubkeyIndex,
    addressQueuePubkeyIndex,
    rootIndex: proofRpcResult.rootIndices[0],
  };

  return {
    proof,
    addressTreeInfo,
    outputStateTreeIndex: outputMerkleTreeIndex,
    remainingAccounts: remainingAccounts.toAccountMetas().remainingAccounts,
  };
}

/**
 * Prepare proof and accounts for operating on an existing compressed stake account
 */
async function prepareStakeOperation(
  rpc: Rpc,
  stakeAddress: PublicKey,
  programId: PublicKey,
  coder: anchor.BorshCoder,
) {
  const { merkleTree } = defaultTestStateTreeAccounts();

  // Fetch the compressed account
  const compressedAccount = await rpc.getCompressedAccount(bn(stakeAddress.toBytes()));
  if (!compressedAccount || !compressedAccount.data || compressedAccount.data.data.length === 0) {
    throw new Error('Compressed stake account not found');
  }

  // Decode the stake data
  const stakeData = coder.types.decode('CompressedStakeAccount', Buffer.from(compressedAccount.data.data));

  // Get validity proof
  const proofRpcResult = await rpc.getValidityProofV0(
    [
      {
        hash: compressedAccount.hash,
        tree: compressedAccount.treeInfo.tree,
        queue: compressedAccount.treeInfo.queue,
      },
    ],
    [],
  );

  const systemAccountConfig = SystemAccountMetaConfig.new(programId);
  const remainingAccounts = PackedAccounts.newWithSystemAccounts(systemAccountConfig);

  const merkleTreePubkeyIndex = remainingAccounts.insertOrGet(compressedAccount.treeInfo.tree);
  const queuePubkeyIndex = remainingAccounts.insertOrGet(compressedAccount.treeInfo.queue);
  const outputMerkleTreeIndex = remainingAccounts.insertOrGet(merkleTree);

  const proof = { 0: proofRpcResult.compressedProof };
  const stakeAccountMeta = {
    treeInfo: {
      rootIndex: proofRpcResult.rootIndices[0],
      proveByIndex: false,
      merkleTreePubkeyIndex,
      queuePubkeyIndex,
      leafIndex: compressedAccount.leafIndex,
    },
    address: Array.from(stakeAddress.toBytes()),
    outputStateTreeIndex: outputMerkleTreeIndex,
  };

  return {
    proof,
    stakeAccountMeta,
    stakeData,
    remainingAccounts: remainingAccounts.toAccountMetas().remainingAccounts,
    compressedAccount,
  };
}

/**
 * Prepare proof and accounts for read-only operations (withdraw)
 */
async function prepareStakeReadOnly(rpc: Rpc, stakeAddress: PublicKey, programId: PublicKey, coder: anchor.BorshCoder) {
  // Fetch the compressed account
  const compressedAccount = await rpc.getCompressedAccount(bn(stakeAddress.toBytes()));
  if (!compressedAccount || !compressedAccount.data || compressedAccount.data.data.length === 0) {
    throw new Error('Compressed stake account not found');
  }

  // Decode the stake data
  const stakeData = coder.types.decode('CompressedStakeAccount', Buffer.from(compressedAccount.data.data));

  // Get validity proof
  const proofRpcResult = await rpc.getValidityProofV0(
    [
      {
        hash: compressedAccount.hash,
        tree: compressedAccount.treeInfo.tree,
        queue: compressedAccount.treeInfo.queue,
      },
    ],
    [],
  );

  const systemAccountConfig = SystemAccountMetaConfig.new(programId);
  const remainingAccounts = PackedAccounts.newWithSystemAccounts(systemAccountConfig);

  const merkleTreePubkeyIndex = remainingAccounts.insertOrGet(compressedAccount.treeInfo.tree);
  const queuePubkeyIndex = remainingAccounts.insertOrGet(compressedAccount.treeInfo.queue);

  const proof = { 0: proofRpcResult.compressedProof };
  const stakeAccountMeta = {
    treeInfo: {
      rootIndex: proofRpcResult.rootIndices[0],
      proveByIndex: false,
      merkleTreePubkeyIndex,
      queuePubkeyIndex,
      leafIndex: compressedAccount.leafIndex,
    },
    address: Array.from(stakeAddress.toBytes()),
  };

  return {
    proof,
    stakeAccountMeta,
    stakeData,
    remainingAccounts: remainingAccounts.toAccountMetas().remainingAccounts,
    compressedAccount,
  };
}

/**
 * Fetch and decode a compressed stake account
 */
async function fetchCompressedStake(rpc: Rpc, stakeAddress: PublicKey, coder: anchor.BorshCoder) {
  const compressedAccount = await rpc.getCompressedAccount(bn(stakeAddress.toBytes()));
  if (!compressedAccount || !compressedAccount.data || compressedAccount.data.data.length === 0) {
    return null;
  }

  const stakeData = coder.types.decode('CompressedStakeAccount', Buffer.from(compressedAccount.data.data));
  return stakeData;
}

export {
  ask,
  buf2hex,
  calculateXnos,
  getDummyKey,
  getTimestamp,
  getTokenBalance,
  getUsers,
  createNosMint,
  now,
  pda,
  setupAnchorAndPrograms,
  setupSolanaUser,
  setupProgram,
  sleep,
  solanaExplorer,
  updateRewards,
  mapUsers,
  mintNosTo,
  // Light Protocol utilities
  createLightRpc,
  deriveStakeAddress,
  prepareStakeCreate,
  prepareStakeOperation,
  prepareStakeReadOnly,
  fetchCompressedStake,
};
