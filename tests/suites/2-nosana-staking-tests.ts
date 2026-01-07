import * as anchor from '@coral-xyz/anchor';
import { web3 } from '@coral-xyz/anchor';
import { expect } from 'chai';
import {
  calculateXnos,
  getTokenBalance,
  sleep,
  prepareStakeCreate,
  prepareStakeOperation,
  prepareStakeReadOnly,
  fetchCompressedStake,
  deriveStakeAddress,
} from '../utils';
import { beforeEach } from 'mocha';
import { PublicKey } from '@solana/web3.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Accounts = any;

export default function suite() {
  beforeEach(async function () {
    if (this.exists.stake) {
      this.userBalanceBefore = await getTokenBalance(this.provider, this.accounts.user);
      this.vaultBalanceBefore = await getTokenBalance(this.provider, this.accounts.vault);
    }
  });

  afterEach(async function () {
    if (this.exists.stake) {
      this.userBalanceAfter = await getTokenBalance(this.provider, this.accounts.user);
      this.vaultBalanceAfter = await getTokenBalance(this.provider, this.accounts.vault);
      expect(this.userBalanceAfter).to.equal(this.balances.user, 'user');
      expect(this.vaultBalanceAfter).to.equal(this.balances.vaultStaking, 'vault');
    }
  });

  describe('init()', async function () {
    it('can initialize', async function () {
      await this.stakingProgram.methods.init().accounts(this.accounts as Accounts).rpc();
    });
  });

  describe('stake()', async function () {
    it('can not stake too short', async function () {
      let msg = '';
      this.accounts.vault = this.vaults.staking;

      // Prepare compressed account creation
      const { proof, addressTreeInfo, outputStateTreeIndex, remainingAccounts } = await prepareStakeCreate(
        this.rpc,
        this.accounts.stake,
        this.stakingProgram.programId,
      );

      const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
      await this.stakingProgram.methods
        .stake(
          new anchor.BN(this.constants.stakeAmount),
          new anchor.BN(this.constants.stakeDurationMin - 1),
          proof,
          addressTreeInfo,
          outputStateTreeIndex,
        )
        .accounts(this.accounts as Accounts)
        .remainingAccounts(remainingAccounts)
        .preInstructions([computeBudgetIx])
        .rpc()
        .catch((e) => (msg = e.error.errorMessage));
      expect(msg).to.equal(this.constants.errors.StakeDurationTooShort);
    });

    it('can not stake too long', async function () {
      let msg = '';

      // Prepare compressed account creation
      const { proof, addressTreeInfo, outputStateTreeIndex, remainingAccounts } = await prepareStakeCreate(
        this.rpc,
        this.accounts.stake,
        this.stakingProgram.programId,
      );

      const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
      await this.stakingProgram.methods
        .stake(
          new anchor.BN(this.constants.stakeAmount),
          new anchor.BN(this.constants.stakeDurationMax + 1),
          proof,
          addressTreeInfo,
          outputStateTreeIndex,
        )
        .accounts(this.accounts as Accounts)
        .remainingAccounts(remainingAccounts)
        .preInstructions([computeBudgetIx])
        .rpc()
        .catch((e) => (msg = e.error.errorMessage));
      expect(msg).to.equal(this.constants.errors.StakeDurationTooLong);
    });

    it('can stake minimum', async function () {
      // Prepare compressed account creation
      const { proof, addressTreeInfo, outputStateTreeIndex, remainingAccounts } = await prepareStakeCreate(
        this.rpc,
        this.accounts.stake,
        this.stakingProgram.programId,
      );

      const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
      await this.stakingProgram.methods
        .stake(
          new anchor.BN(this.constants.stakeMinimum),
          new anchor.BN(this.constants.stakeDurationMin),
          proof,
          addressTreeInfo,
          outputStateTreeIndex,
        )
        .accounts(this.accounts as Accounts)
        .remainingAccounts(remainingAccounts)
        .preInstructions([computeBudgetIx])
        .rpc();
      this.balances.user -= this.constants.stakeMinimum;
      this.balances.vaultStaking += this.constants.stakeMinimum;
      this.exists.stake = true;

      // test stake - fetch from compressed account
      const stake = await fetchCompressedStake(this.rpc, this.accounts.stake, this.coder);
      expect(stake.amount.toNumber()).to.equal(this.constants.stakeMinimum, 'amount');
      expect(stake.vault.toString()).to.equal(this.accounts.vault.toString(), 'vault');
      expect(stake.authority.toString()).to.equal(this.accounts.authority.toString(), 'authority');
      expect(stake.duration.toNumber()).to.equal(this.constants.stakeDurationMin, 'duration');
      expect(stake.xnos.toNumber()).to.equal(
        calculateXnos(this.constants.stakeDurationMin, this.constants.stakeMinimum),
        'xnos',
      );
    });

    it('can stake maximum for user 4', async function () {
      // Prepare compressed account creation for user 4
      const { proof, addressTreeInfo, outputStateTreeIndex, remainingAccounts } = await prepareStakeCreate(
        this.rpc,
        this.users.user4.stake,
        this.stakingProgram.programId,
      );

      const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
      await this.stakingProgram.methods
        .stake(
          new anchor.BN(this.constants.stakeAmount),
          new anchor.BN(this.constants.stakeDurationMax),
          proof,
          addressTreeInfo,
          outputStateTreeIndex,
        )
        .accounts({
          ...this.accounts,
          user: this.users.user4.ata,
          authority: this.users.user4.publicKey,
          vault: this.users.user4.vault,
        } as Accounts)
        .remainingAccounts(remainingAccounts)
        .preInstructions([computeBudgetIx])
        .signers([this.users.user4.user])
        .rpc();
      this.users.user4.balance -= this.constants.stakeAmount;
    });

    it('can stake for node 1', async function () {
      const amount = this.constants.minimumNodeStake - 1;

      // Prepare compressed account creation for node 1
      const { proof, addressTreeInfo, outputStateTreeIndex, remainingAccounts } = await prepareStakeCreate(
        this.rpc,
        this.users.node1.stake,
        this.stakingProgram.programId,
      );

      const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
      await this.stakingProgram.methods
        .stake(
          new anchor.BN(amount),
          new anchor.BN(this.constants.stakeDurationMin),
          proof,
          addressTreeInfo,
          outputStateTreeIndex,
        )
        .accounts({
          ...this.accounts,
          user: this.users.node1.ata,
          authority: this.users.node1.publicKey,
          vault: this.users.node1.vault,
        } as Accounts)
        .remainingAccounts(remainingAccounts)
        .preInstructions([computeBudgetIx])
        .signers([this.users.node1.user])
        .rpc();
      this.users.node1.balance -= amount;
    });

    it('can stake for node 2, and unstake', async function () {
      // Prepare compressed account creation for node 2
      const { proof, addressTreeInfo, outputStateTreeIndex, remainingAccounts } = await prepareStakeCreate(
        this.rpc,
        this.users.node2.stake,
        this.stakingProgram.programId,
      );

      const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
      await this.stakingProgram.methods
        .stake(
          new anchor.BN(this.constants.minimumNodeStake),
          new anchor.BN(this.constants.stakeDurationMin),
          proof,
          addressTreeInfo,
          outputStateTreeIndex,
        )
        .accounts({
          ...this.accounts,
          user: this.users.node2.ata,
          authority: this.users.node2.publicKey,
          vault: this.users.node2.vault,
        } as Accounts)
        .remainingAccounts(remainingAccounts)
        .preInstructions([computeBudgetIx])
        .signers([this.users.node2.user])
        .rpc();

      // Now unstake - need to get the stake data and proof
      const {
        proof: unstakeProof,
        stakeAccountMeta,
        stakeData,
        remainingAccounts: unstakeRemainingAccounts,
      } = await prepareStakeOperation(this.rpc, this.users.node2.stake, this.stakingProgram.programId, this.coder);

      await this.stakingProgram.methods
        .unstake(unstakeProof, stakeAccountMeta, stakeData)
        .accounts({
          ...this.accounts,
          authority: this.users.node2.publicKey,
          reward: this.users.node2.reward,
        })
        .remainingAccounts(unstakeRemainingAccounts)
        .preInstructions([computeBudgetIx])
        .signers([this.users.node2.user])
        .rpc();
      this.users.node2.balance -= this.constants.minimumNodeStake;
    });

    it('can stake for other nodes', async function () {
      for (const node of this.users.otherNodes) {
        // Prepare compressed account creation for each node
        const { proof, addressTreeInfo, outputStateTreeIndex, remainingAccounts } = await prepareStakeCreate(
          this.rpc,
          node.stake,
          this.stakingProgram.programId,
        );

        const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
        await this.stakingProgram.methods
          .stake(
            new anchor.BN(this.constants.stakeAmount * 2),
            new anchor.BN(3 * this.constants.stakeDurationMin),
            proof,
            addressTreeInfo,
            outputStateTreeIndex,
          )
          .accounts({
            ...this.accounts,
            user: node.ata,
            authority: node.publicKey,
            vault: node.vault,
          } as Accounts)
          .remainingAccounts(remainingAccounts)
          .preInstructions([computeBudgetIx])
          .signers([node.user])
          .rpc();
        node.balance -= this.constants.stakeAmount * 2;
        expect(await getTokenBalance(this.provider, node.ata)).to.equal(node.balance);
      }
    });
  });

  describe('extend()', async function () {
    it('can extend stake duration', async function () {
      const accountBefore = await fetchCompressedStake(this.rpc, this.accounts.stake, this.coder);

      // Prepare extend operation
      const { proof, stakeAccountMeta, stakeData, remainingAccounts } = await prepareStakeOperation(
        this.rpc,
        this.accounts.stake,
        this.stakingProgram.programId,
        this.coder,
      );

      const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
      await this.stakingProgram.methods
        .extend(new anchor.BN(7), proof, stakeAccountMeta, stakeData)
        .accounts(this.accounts as Accounts)
        .remainingAccounts(remainingAccounts)
        .preInstructions([computeBudgetIx])
        .rpc();
      const accountAfter = await fetchCompressedStake(this.rpc, this.accounts.stake, this.coder);
      expect(accountAfter.duration.toNumber()).to.equal(accountBefore.duration.toNumber() + 7);
    });

    it('can not extend a stake that is too long', async function () {
      let msg = '';

      // Prepare extend operation
      const { proof, stakeAccountMeta, stakeData, remainingAccounts } = await prepareStakeOperation(
        this.rpc,
        this.accounts.stake,
        this.stakingProgram.programId,
        this.coder,
      );

      const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
      await this.stakingProgram.methods
        .extend(new anchor.BN(this.constants.stakeDurationMax), proof, stakeAccountMeta, stakeData)
        .accounts(this.accounts as Accounts)
        .remainingAccounts(remainingAccounts)
        .preInstructions([computeBudgetIx])
        .rpc()
        .catch((e) => (msg = e.error.errorMessage));
      expect(msg).to.equal(this.constants.errors.StakeDurationTooLong);
    });

    it('can extend a stake', async function () {
      // Prepare extend operation
      const { proof, stakeAccountMeta, stakeData, remainingAccounts } = await prepareStakeOperation(
        this.rpc,
        this.accounts.stake,
        this.stakingProgram.programId,
        this.coder,
      );

      const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
      await this.stakingProgram.methods
        .extend(new anchor.BN(this.constants.stakeDurationMin), proof, stakeAccountMeta, stakeData)
        .accounts(this.accounts as Accounts)
        .remainingAccounts(remainingAccounts)
        .preInstructions([computeBudgetIx])
        .rpc();

      // check stake
      const stake = await fetchCompressedStake(this.rpc, this.accounts.stake, this.coder);
      expect(stake.duration.toNumber()).to.equal(this.constants.stakeDurationMin * 2 + 7);
      expect(stake.amount.toNumber()).to.equal(this.constants.stakeMinimum);
      expect(stake.xnos.toNumber()).to.equal(
        calculateXnos(this.constants.stakeDurationMin * 2 + 7, this.constants.stakeMinimum),
        'xnos',
      );
    });
  });

  describe('unstake()', async function () {
    it('can unstake from other account', async function () {
      let msg = '';

      // Prepare unstake operation - get the stake data for main user
      const { proof, stakeAccountMeta, stakeData, remainingAccounts } = await prepareStakeOperation(
        this.rpc,
        this.accounts.stake,
        this.stakingProgram.programId,
        this.coder,
      );

      const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
      await this.stakingProgram.methods
        .unstake(proof, stakeAccountMeta, stakeData)
        .accounts({
          ...this.accounts, authority: this.users.user3.publicKey })
        .remainingAccounts(remainingAccounts)
        .preInstructions([computeBudgetIx])
        .signers([this.users.user3.user])
        .rpc()
        .catch((e) => (msg = e.error.errorMessage));
      expect(msg).to.equal(this.constants.errors.Unauthorized);
    });

    it('can not unstake with invalid reward account', async function () {
      let msg = '';

      // Prepare unstake operation
      const { proof, stakeAccountMeta, stakeData, remainingAccounts } = await prepareStakeOperation(
        this.rpc,
        this.accounts.stake,
        this.stakingProgram.programId,
        this.coder,
      );

      const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
      await this.stakingProgram.methods
        .unstake(proof, stakeAccountMeta, stakeData)
        .accounts({
          ...this.accounts,
          reward: anchor.web3.Keypair.generate().publicKey,
        })
        .remainingAccounts(remainingAccounts)
        .preInstructions([computeBudgetIx])
        .rpc()
        .catch((e) => (msg = e.error.errorMessage));
      expect(msg).to.equal(this.constants.errors.InvalidAccount);

      // Get fresh proof for second attempt
      const {
        proof: proof2,
        stakeAccountMeta: stakeAccountMeta2,
        stakeData: stakeData2,
        remainingAccounts: remainingAccounts2,
      } = await prepareStakeOperation(this.rpc, this.accounts.stake, this.stakingProgram.programId, this.coder);

      await this.stakingProgram.methods
        .unstake(proof2, stakeAccountMeta2, stakeData2)
        .accounts({
          ...this.accounts,
          reward: this.accounts.stake,
        })
        .remainingAccounts(remainingAccounts2)
        .preInstructions([computeBudgetIx])
        .rpc()
        .catch((e) => (msg = e.error.errorMessage));
      expect(msg).to.equal(this.constants.errors.StakeHasReward);
    });

    it('can unstake', async function () {
      // Prepare unstake operation
      const { proof, stakeAccountMeta, stakeData, remainingAccounts } = await prepareStakeOperation(
        this.rpc,
        this.accounts.stake,
        this.stakingProgram.programId,
        this.coder,
      );

      const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
      await this.stakingProgram.methods
        .unstake(proof, stakeAccountMeta, stakeData)
        .accounts(this.accounts as Accounts)
        .remainingAccounts(remainingAccounts)
        .preInstructions([computeBudgetIx])
        .rpc();

      const data = await fetchCompressedStake(this.rpc, this.accounts.stake, this.coder);
      expect(Date.now() / 1e3).to.be.closeTo(data.timeUnstake.toNumber(), 3);

      // check stake
      const stake = await fetchCompressedStake(this.rpc, this.accounts.stake, this.coder);
      expect(stake.xnos.toNumber()).to.equal(0);
    });
  });

  describe('topup(), restake()', async function () {
    it('can not topup after unstake', async function () {
      let msg = '';

      // Prepare topup operation
      const { proof, stakeAccountMeta, stakeData, remainingAccounts } = await prepareStakeOperation(
        this.rpc,
        this.accounts.stake,
        this.stakingProgram.programId,
        this.coder,
      );

      const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
      await this.stakingProgram.methods
        .topup(new anchor.BN(this.constants.stakeAmount), proof, stakeAccountMeta, stakeData)
        .accounts(this.accounts as Accounts)
        .remainingAccounts(remainingAccounts)
        .preInstructions([computeBudgetIx])
        .rpc()
        .catch((e) => (msg = e.error.errorMessage));
      expect(msg).to.equal(this.constants.errors.StakeAlreadyUnstaked);
    });

    it('can restake', async function () {
      // Prepare restake operation
      const { proof, stakeAccountMeta, stakeData, remainingAccounts } = await prepareStakeOperation(
        this.rpc,
        this.accounts.stake,
        this.stakingProgram.programId,
        this.coder,
      );

      const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
      await this.stakingProgram.methods
        .restake(proof, stakeAccountMeta, stakeData)
        .accounts(this.accounts as Accounts)
        .remainingAccounts(remainingAccounts)
        .preInstructions([computeBudgetIx])
        .rpc();

      // Verify restake cleared the unstake timestamp
      const stakeAccount = await fetchCompressedStake(this.rpc, this.accounts.stake, this.coder);
      expect(stakeAccount.timeUnstake.toNumber()).to.equal(0);
    });

    it('can topup', async function () {
      // Prepare topup operation
      const { proof, stakeAccountMeta, stakeData, remainingAccounts } = await prepareStakeOperation(
        this.rpc,
        this.accounts.stake,
        this.stakingProgram.programId,
        this.coder,
      );

      const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
      await this.stakingProgram.methods
        .topup(new anchor.BN(this.constants.stakeAmount), proof, stakeAccountMeta, stakeData)
        .accounts(this.accounts as Accounts)
        .remainingAccounts(remainingAccounts)
        .preInstructions([computeBudgetIx])
        .rpc();
      this.balances.user -= this.constants.stakeAmount;
      this.balances.vaultStaking += this.constants.stakeAmount;

      // check stake
      const stake = await fetchCompressedStake(this.rpc, this.accounts.stake, this.coder);
      expect(stake.duration.toNumber()).to.equal(this.constants.stakeDurationMin * 2 + 7, 'duration');
      expect(stake.amount.toNumber()).to.equal(this.constants.stakeMinimum + this.constants.stakeAmount, 'amount');
      expect(stake.xnos.toNumber()).to.equal(
        calculateXnos(
          this.constants.stakeDurationMin * 2 + 7,
          this.constants.stakeMinimum + this.constants.stakeAmount,
        ),
        'xnos',
      );
    });
  });

  describe('close()', async function () {
    it('can not close before unstake', async function () {
      let msg = '';

      // Prepare close operation
      const { proof, stakeAccountMeta, stakeData, remainingAccounts } = await prepareStakeOperation(
        this.rpc,
        this.accounts.stake,
        this.stakingProgram.programId,
        this.coder,
      );

      const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
      await this.stakingProgram.methods
        .close(proof, stakeAccountMeta, stakeData)
        .accounts(this.accounts as Accounts)
        .remainingAccounts(remainingAccounts)
        .preInstructions([computeBudgetIx])
        .rpc()
        .catch((e) => (msg = e.error.errorMessage));
      expect(msg).to.equal(this.constants.errors.StakeNotUnstaked);
    });

    it('can unstake', async function () {
      // Prepare unstake operation
      const { proof, stakeAccountMeta, stakeData, remainingAccounts } = await prepareStakeOperation(
        this.rpc,
        this.accounts.stake,
        this.stakingProgram.programId,
        this.coder,
      );

      const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
      await this.stakingProgram.methods
        .unstake(proof, stakeAccountMeta, stakeData)
        .accounts(this.accounts as Accounts)
        .remainingAccounts(remainingAccounts)
        .preInstructions([computeBudgetIx])
        .rpc();
    });

    it('can not close after too soon unstake', async function () {
      let msg = '';

      // Prepare close operation
      const { proof, stakeAccountMeta, stakeData, remainingAccounts } = await prepareStakeOperation(
        this.rpc,
        this.accounts.stake,
        this.stakingProgram.programId,
        this.coder,
      );

      const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
      await this.stakingProgram.methods
        .close(proof, stakeAccountMeta, stakeData)
        .accounts(this.accounts as Accounts)
        .remainingAccounts(remainingAccounts)
        .preInstructions([computeBudgetIx])
        .rpc()
        .catch((e) => (msg = e.error.errorMessage));
      expect(msg).to.equal(this.constants.errors.StakeLocked);

      // Get fresh proof for restake
      const {
        proof: restakeProof,
        stakeAccountMeta: restakeStakeAccountMeta,
        stakeData: restakeStakeData,
        remainingAccounts: restakeRemainingAccounts,
      } = await prepareStakeOperation(this.rpc, this.accounts.stake, this.stakingProgram.programId, this.coder);

      await this.stakingProgram.methods
        .restake(restakeProof, restakeStakeAccountMeta, restakeStakeData)
        .accounts(this.accounts as Accounts)
        .remainingAccounts(restakeRemainingAccounts)
        .preInstructions([computeBudgetIx])
        .rpc();
    });

    //
    //  To run this test you will have to modify claim.rs and change stake.duration to 5 seconds:
    //
    //          constraint = stake.time_unstake + i64::try_from(5).unwrap() <
    //                                                          ^

    /*
    it('Claim after unstake duration', async function () {
      let balanceBefore = await getTokenBalance(this.provider, this.users.node2.ata);
      await sleep(5000);
      await this.stakingProgram.methods
        .claim()
        .accounts({
          ...this.accounts,
          user: this.users.node2.ata,
          stake: this.users.node2.stake,
          authority: this.users.node2.publicKey,
          vault: this.users.node2.vault,
        })
        .signers([this.users.node2.user])
        .rpc();
      let balanceAfter = await getTokenBalance(this.provider, this.users.node2.ata);
      expect(balanceAfter).to.equal(balanceBefore + this.constants.stakeAmount);
    });

     */
  });

  describe('withdraw()', async function () {
    it('can withdraw after unstake', async function () {
      const seconds = 10; // increase this number get a higher test reliability
      const duration = this.constants.stakeDurationMin * 2 + 7;
      const stakeDataBefore = await fetchCompressedStake(this.rpc, this.accounts.stake, this.coder);
      const amount = stakeDataBefore.amount.toNumber();
      const emission = amount / duration;
      const expectedWithdraw = Math.floor(emission * seconds);

      // Prepare unstake operation
      const {
        proof: unstakeProof,
        stakeAccountMeta: unstakeStakeAccountMeta,
        stakeData: unstakeStakeData,
        remainingAccounts: unstakeRemainingAccounts,
      } = await prepareStakeOperation(this.rpc, this.accounts.stake, this.stakingProgram.programId, this.coder);

      const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
      await this.stakingProgram.methods
        .unstake(unstakeProof, unstakeStakeAccountMeta, unstakeStakeData)
        .accounts(this.accounts as Accounts)
        .remainingAccounts(unstakeRemainingAccounts)
        .preInstructions([computeBudgetIx])
        .rpc();

      await sleep(seconds);

      // Prepare withdraw operation (read-only)
      const {
        proof: withdrawProof,
        stakeAccountMeta: withdrawStakeAccountMeta,
        stakeData: withdrawStakeData,
        remainingAccounts: withdrawRemainingAccounts,
      } = await prepareStakeReadOnly(this.rpc, this.accounts.stake, this.stakingProgram.programId, this.coder);

      await this.stakingProgram.methods
        .withdraw(withdrawProof, withdrawStakeAccountMeta, withdrawStakeData)
        .accounts(this.accounts as Accounts)
        .remainingAccounts(withdrawRemainingAccounts)
        .preInstructions([computeBudgetIx])
        .rpc();

      const balanceAfter = await getTokenBalance(this.provider, this.accounts.user);
      expect(balanceAfter).to.be.greaterThan(this.userBalanceBefore);

      const stake = await fetchCompressedStake(this.rpc, this.accounts.stake, this.coder);
      expect(stake.amount.toNumber()).to.equal(this.balances.vaultStaking);
      expect(stake.amount.toNumber()).to.equal(this.constants.stakeMinimum + this.constants.stakeAmount);
      expect(stake.duration.toNumber()).to.equal(duration, 'duration');

      const withDraw = balanceAfter - this.userBalanceBefore;
      expect(withDraw).to.be.closeTo(expectedWithdraw, 2 * emission, 'withdraw'); // we allow 2 second error

      this.balances.user += withDraw;
      this.balances.vaultStaking -= withDraw;
    });

    it('can withdraw a second time', async function () {
      const seconds = 10; // increase this number get a higher test reliability
      const duration = this.constants.stakeDurationMin * 2 + 7;
      const stakeDataBefore = await fetchCompressedStake(this.rpc, this.accounts.stake, this.coder);
      const amount = stakeDataBefore.amount.toNumber();
      const emission = amount / duration;
      const expectedWithdraw = Math.floor(emission * seconds);

      await sleep(seconds);

      // Prepare withdraw operation (read-only)
      const { proof, stakeAccountMeta, stakeData, remainingAccounts } = await prepareStakeReadOnly(
        this.rpc,
        this.accounts.stake,
        this.stakingProgram.programId,
        this.coder,
      );

      const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
      await this.stakingProgram.methods
        .withdraw(proof, stakeAccountMeta, stakeData)
        .accounts(this.accounts as Accounts)
        .remainingAccounts(remainingAccounts)
        .preInstructions([computeBudgetIx])
        .rpc();

      const balanceAfter = await getTokenBalance(this.provider, this.accounts.user);
      expect(balanceAfter).to.be.greaterThan(this.userBalanceBefore);

      const withDraw = balanceAfter - this.userBalanceBefore;
      expect(withDraw).to.be.closeTo(expectedWithdraw, 2 * emission, 'withdraw'); // we allow 2 second error

      this.balances.user += withDraw;
      this.balances.vaultStaking -= withDraw;
    });

    it('can restake', async function () {
      // Prepare restake operation
      const { proof, stakeAccountMeta, stakeData, remainingAccounts } = await prepareStakeOperation(
        this.rpc,
        this.accounts.stake,
        this.stakingProgram.programId,
        this.coder,
      );

      const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
      await this.stakingProgram.methods
        .restake(proof, stakeAccountMeta, stakeData)
        .accounts(this.accounts as Accounts)
        .remainingAccounts(remainingAccounts)
        .preInstructions([computeBudgetIx])
        .rpc();

      const amountStake = (await fetchCompressedStake(this.rpc, this.accounts.stake, this.coder)).amount.toNumber();
      const amountVault = await getTokenBalance(this.provider, this.accounts.vault);
      expect(amountStake).to.equal(amountVault);
    });
  });

  // SKIPPED: These tests require the admin authority keypair (XXXxddiNnmoD2h2LbQYaL76Swi21MaQbtBbRynAdQL8)
  // which is only available in CI environment. Run in CI for full test coverage.
  describe.skip('slash(), update_authority()', async function () {
    it('can slash', async function () {
      const stakeBefore = await fetchCompressedStake(this.rpc, this.users.nodes[2].stake, this.coder);

      // Prepare slash operation
      const { proof, stakeAccountMeta, stakeData, remainingAccounts } = await prepareStakeOperation(
        this.rpc,
        this.users.nodes[2].stake,
        this.stakingProgram.programId,
        this.coder,
      );

      const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
      await this.stakingProgram.methods
        .slash(new anchor.BN(this.constants.slashAmount), proof, stakeAccountMeta, stakeData)
        .accounts({
          ...this.accounts,
          vault: this.users.nodes[2].vault,
        })
        .remainingAccounts(remainingAccounts)
        .preInstructions([computeBudgetIx])
        .rpc();

      this.balances.user += this.constants.slashAmount;
      const stakeAfter = await fetchCompressedStake(this.rpc, this.users.nodes[2].stake, this.coder);
      expect(stakeAfter.amount.toNumber()).to.equal(stakeBefore.amount.toNumber() - this.constants.slashAmount);
    });

    it('can not slash unauthorized', async function () {
      let msg = '';

      // Prepare slash operation
      const { proof, stakeAccountMeta, stakeData, remainingAccounts } = await prepareStakeOperation(
        this.rpc,
        this.users.nodes[2].stake,
        this.stakingProgram.programId,
        this.coder,
      );

      const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
      await this.stakingProgram.methods
        .slash(new anchor.BN(this.constants.slashAmount), proof, stakeAccountMeta, stakeData)
        .accounts({
          ...this.accounts, authority: this.users.node1.publicKey } as Accounts)
        .remainingAccounts(remainingAccounts)
        .preInstructions([computeBudgetIx])
        .signers([this.users.node1.user])
        .rpc()
        .catch((e) => (msg = e.error.errorMessage));
      expect(msg).to.equal(this.constants.errors.Unauthorized);
    });

    it('can not slash unauthorized hack 2', async function () {
      let msg = '';

      // Prepare slash operation
      const { proof, stakeAccountMeta, stakeData, remainingAccounts } = await prepareStakeOperation(
        this.rpc,
        this.users.nodes[2].stake,
        this.stakingProgram.programId,
        this.coder,
      );

      const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
      await this.stakingProgram.methods
        .slash(new anchor.BN(this.constants.slashAmount), proof, stakeAccountMeta, stakeData)
        .accounts({
          ...this.accounts, settings: this.accounts.stake } as Accounts)
        .remainingAccounts(remainingAccounts)
        .preInstructions([computeBudgetIx])
        .rpc()
        .catch((e) => (msg = e.error.errorMessage));
      expect(msg).to.equal(this.constants.errors.Solana8ByteConstraint);
    });

    it('can update slash authority', async function () {
      await this.stakingProgram.methods
        .updateSettings()
        .accounts({
          ...this.accounts, newAuthority: this.users.node1.publicKey } as Accounts)
        .rpc();
      const stats = await this.stakingProgram.account.settingsAccount.fetch(this.accounts.settings);
      expect(stats.authority.toString()).to.equal(this.users.node1.publicKey.toString());
    });

    it('can slash with node 1', async function () {
      // Prepare slash operation
      const { proof, stakeAccountMeta, stakeData, remainingAccounts } = await prepareStakeOperation(
        this.rpc,
        this.users.nodes[2].stake,
        this.stakingProgram.programId,
        this.coder,
      );

      const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
      await this.stakingProgram.methods
        .slash(new anchor.BN(this.constants.slashAmount), proof, stakeAccountMeta, stakeData)
        .accounts({
          ...this.accounts,
          authority: this.users.node1.publicKey,
          vault: this.users.nodes[2].vault,
        } as Accounts)
        .remainingAccounts(remainingAccounts)
        .preInstructions([computeBudgetIx])
        .signers([this.users.node1.user])
        .rpc();

      this.balances.user += this.constants.slashAmount;
    });

    it('can update settings authority back', async function () {
      await this.stakingProgram.methods
        .updateSettings()
        .accounts({
          ...this.accounts,
          authority: this.users.node1.publicKey,
          newAuthority: this.accounts.authority,
        } as Accounts)
        .signers([this.users.node1.user])
        .rpc();
      const stats = await this.stakingProgram.account.settingsAccount.fetch(this.accounts.settings);
      expect(stats.authority.toString()).to.equal(this.accounts.authority.toString());
    });
  });
}
