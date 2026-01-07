import * as anchor from '@coral-xyz/anchor';
import { web3 } from '@coral-xyz/anchor';
import { expect } from 'chai';
import { BN } from '@coral-xyz/anchor';
import { getTokenBalance, updateRewards, prepareStakeOperation, prepareStakeReadOnly, fetchCompressedStake } from '../utils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Accounts = any;

export default function suite() {
  afterEach(async function () {
    expect(await getTokenBalance(this.provider, this.accounts.user)).to.equal(this.balances.user, 'user balance');
    expect(await getTokenBalance(this.provider, this.vaults.rewards)).to.equal(this.balances.vaultRewards, 'vault');
  });

  describe('init()', async function () {
    it('can initialize the rewards vault', async function () {
      this.accounts.vault = this.vaults.rewards;
      await this.rewardsProgram.methods.init().accounts(this.accounts as Accounts).rpc();

      // test stats
      const stats = await this.rewardsProgram.account.reflectionAccount.fetch(this.accounts.reflection);
      expect(stats.totalXnos.toString()).to.equal(this.total.xnos.toString());
      expect(stats.totalReflection.toString()).to.equal(this.total.reflection.toString());
      expect(stats.rate.toString()).to.equal(this.constants.initialRate.toString());
    });
  });

  describe('enter()', async function () {
    it('can not enter rewards pool with other stake', async function () {
      let msg = '';
      // Use node1's stake for the compressed proof
      const { proof, stakeAccountMeta, stakeData, remainingAccounts } = await prepareStakeReadOnly(
        this.rpc,
        this.users.node1.stake,
        this.stakingProgram.programId,
        this.coder,
      );
      const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
      await this.rewardsProgram.methods
        .enter(proof, stakeAccountMeta, stakeData)
        .accounts(this.accounts as Accounts)
        .remainingAccounts(remainingAccounts)
        .preInstructions([computeBudgetIx])
        .rpc()
        .catch((e) => (msg = e.error.errorMessage));
      expect(msg).to.equal(this.constants.errors.Unauthorized);
    });

    it('can enter rewards pool with main wallet', async function () {
      const { proof, stakeAccountMeta, stakeData, remainingAccounts } = await prepareStakeReadOnly(
        this.rpc,
        this.accounts.stake,
        this.stakingProgram.programId,
        this.coder,
      );
      const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
      await this.rewardsProgram.methods
        .enter(proof, stakeAccountMeta, stakeData)
        .accounts(this.accounts as Accounts)
        .remainingAccounts(remainingAccounts)
        .preInstructions([computeBudgetIx])
        .rpc();
      await updateRewards(this, this.accounts.stake);
    });

    it('can not unstake while reward is open', async function () {
      let msg = '';
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
        .rpc()
        .catch((e) => (msg = e.error.errorMessage));
      expect(msg).to.equal(this.constants.errors.StakeHasReward);
    });

    it('can enter rewards with the other nodes', async function () {
      for (const node of this.users.otherNodes) {
        const { proof, stakeAccountMeta, stakeData, remainingAccounts } = await prepareStakeReadOnly(
          this.rpc,
          node.stake,
          this.stakingProgram.programId,
          this.coder,
        );
        const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
        await this.rewardsProgram.methods
          .enter(proof, stakeAccountMeta, stakeData)
          .accounts({ ...this.accounts as Accounts, reward: node.reward, authority: node.publicKey })
          .remainingAccounts(remainingAccounts)
          .preInstructions([computeBudgetIx])
          .signers([node.user])
          .rpc();
        await updateRewards(this, node.stake);
      }
    });
  });

  describe('add_fee()', async function () {
    it('can add fees to the pool', async function () {
      const fee = new BN(this.constants.feeAmount);
      await this.rewardsProgram.methods.addFee(fee).accounts(this.accounts as Accounts).rpc();
      await updateRewards(this, this.accounts.stake, fee);
      this.balances.user -= this.constants.feeAmount;
      this.balances.vaultRewards += this.constants.feeAmount;
    });

    it('can claim rewards', async function () {
      const reflection = (await this.rewardsProgram.account.rewardAccount.fetch(this.accounts.reward)).reflection;

      const { proof, stakeAccountMeta, stakeData, remainingAccounts } = await prepareStakeReadOnly(
        this.rpc,
        this.accounts.stake,
        this.stakingProgram.programId,
        this.coder,
      );
      const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
      await this.rewardsProgram.methods
        .claim(proof, stakeAccountMeta, stakeData)
        .accounts(this.accounts as Accounts)
        .remainingAccounts(remainingAccounts)
        .preInstructions([computeBudgetIx])
        .rpc();
      const amount = await updateRewards(this, this.accounts.stake, new anchor.BN(0), reflection);

      this.balances.user += amount;
      this.balances.vaultRewards -= amount;
    });

    it('can claim rewards with other users', async function () {
      for (const node of this.users.otherNodes) {
        const reflection = (await this.rewardsProgram.account.rewardAccount.fetch(node.reward)).reflection;
        const { proof, stakeAccountMeta, stakeData, remainingAccounts } = await prepareStakeReadOnly(
          this.rpc,
          node.stake,
          this.stakingProgram.programId,
          this.coder,
        );
        const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
        await this.rewardsProgram.methods
          .claim(proof, stakeAccountMeta, stakeData)
          .accounts({
            ...this.accounts,
            reward: node.reward,
            authority: node.publicKey,
            user: node.ata,
          } as Accounts)
          .remainingAccounts(remainingAccounts)
          .preInstructions([computeBudgetIx])
          .signers([node.user])
          .rpc();
        const amount = await updateRewards(this, node.stake, new anchor.BN(0), reflection);
        node.balance += amount;
        this.balances.vaultRewards -= amount;
      }
      expect(await getTokenBalance(this.provider, this.vaults.rewards)).to.be.closeTo(0, 100, 'vault is empty');
    });
  });

  describe('sync()', async function () {
    it('can add more fees to the pool', async function () {
      await this.rewardsProgram.methods.addFee(new anchor.BN(this.constants.feeAmount)).accounts(this.accounts as Accounts).rpc();
      await updateRewards(this, this.accounts.stake, new anchor.BN(this.constants.feeAmount));
      this.balances.user -= this.constants.feeAmount;
      this.balances.vaultRewards += this.constants.feeAmount;
    });

    it('can topup stake', async function () {
      const { proof, stakeAccountMeta, stakeData, remainingAccounts } = await prepareStakeOperation(
        this.rpc,
        this.accounts.stake,
        this.stakingProgram.programId,
        this.coder,
      );
      const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
      await this.stakingProgram.methods
        .topup(new anchor.BN(this.constants.stakeAmount), proof, stakeAccountMeta, stakeData)
        .accounts({ ...this.accounts as Accounts, vault: this.vaults.staking })
        .remainingAccounts(remainingAccounts)
        .preInstructions([computeBudgetIx])
        .rpc();
      this.balances.user -= this.constants.stakeAmount;
      this.balances.vaultStaking += this.constants.stakeAmount;
    });

    it('can not sync reward reflection for wrong accounts', async function () {
      let msg = '';
      // Use main wallet's stake but wrong reward account
      const { proof, stakeAccountMeta, stakeData, remainingAccounts } = await prepareStakeReadOnly(
        this.rpc,
        this.accounts.stake,
        this.stakingProgram.programId,
        this.coder,
      );
      const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
      await this.rewardsProgram.methods
        .sync(proof, stakeAccountMeta, stakeData)
        .accounts({ ...this.accounts as Accounts, reward: this.users.nodes[4].reward })
        .remainingAccounts(remainingAccounts)
        .preInstructions([computeBudgetIx])
        .rpc()
        .catch((e) => (msg = e.error.errorMessage));
      expect(msg).to.equal(this.constants.errors.Unauthorized);
    });

    it('can sync reward reflection', async function () {
      const before = await this.rewardsProgram.account.rewardAccount.fetch(this.accounts.reward);
      const { proof, stakeAccountMeta, stakeData, remainingAccounts } = await prepareStakeReadOnly(
        this.rpc,
        this.accounts.stake,
        this.stakingProgram.programId,
        this.coder,
      );
      const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
      await this.rewardsProgram.methods
        .sync(proof, stakeAccountMeta, stakeData)
        .accounts(this.accounts as Accounts)
        .remainingAccounts(remainingAccounts)
        .preInstructions([computeBudgetIx])
        .rpc();
      const after = await this.rewardsProgram.account.rewardAccount.fetch(this.accounts.reward);
      const fetchedStakeData = await fetchCompressedStake(this.rpc, this.accounts.stake, this.coder);
      const stake = fetchedStakeData.xnos.toNumber();

      // test xnos before vs after
      expect(before.xnos.toNumber()).to.be.lessThan(after.xnos.toNumber());
      expect(after.xnos.toNumber()).to.equal(stake);

      // update totals
      this.total.xnos.iadd(after.xnos.sub(before.xnos));
      this.total.reflection.isub(before.reflection);
      const reflection = after.xnos
        .add(before.reflection.div(new anchor.BN(this.total.rate)).sub(before.xnos))
        .mul(this.total.rate);
      this.total.reflection.iadd(reflection);
      expect(reflection.toString()).to.equal(after.reflection.toString());

      // test stats
      const stats = await this.rewardsProgram.account.reflectionAccount.fetch(this.accounts.reflection);
      expect(stats.totalXnos.toString()).to.equal(this.total.xnos.toString(), 'Total XNOS error');
      expect(stats.totalReflection.toString()).to.equal(this.total.reflection.toString(), 'Total reflection error');
      expect(stats.rate.toString()).to.equal(this.total.rate.toString(), 'Rate error');
    });

    it('can add another round of fees to the pool', async function () {
      await this.rewardsProgram.methods.addFee(new anchor.BN(this.constants.feeAmount)).accounts(this.accounts as Accounts).rpc();
      await updateRewards(this, this.accounts.stake, new anchor.BN(this.constants.feeAmount));
      this.balances.user -= this.constants.feeAmount;
      this.balances.vaultRewards += this.constants.feeAmount;
    });

    it('can sync reward reflection for others', async function () {
      for (const node of this.users.otherNodes) {
        const before = await this.rewardsProgram.account.rewardAccount.fetch(node.reward);
        const { proof, stakeAccountMeta, stakeData, remainingAccounts } = await prepareStakeReadOnly(
          this.rpc,
          node.stake,
          this.stakingProgram.programId,
          this.coder,
        );
        const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
        await this.rewardsProgram.methods
          .sync(proof, stakeAccountMeta, stakeData)
          .accounts({ ...this.accounts as Accounts, reward: node.reward })
          .remainingAccounts(remainingAccounts)
          .preInstructions([computeBudgetIx])
          .rpc();
        const after = await this.rewardsProgram.account.rewardAccount.fetch(node.reward);
        const fetchedStakeData = await fetchCompressedStake(this.rpc, node.stake, this.coder);
        expect(before.xnos.toNumber()).to.equal(after.xnos.toNumber());
        expect(fetchedStakeData.xnos.toNumber()).to.equal(after.xnos.toNumber());
      }
    });
  });

  describe('close()', async function () {
    it('can close a reward account and unstake in the same tx', async function () {
      let stakeData = await fetchCompressedStake(this.rpc, this.accounts.stake, this.coder);
      expect(stakeData.timeUnstake.toNumber()).to.equal(0);

      // Prepare unstake with compressed account
      const { proof, stakeAccountMeta, stakeData: unstakeData, remainingAccounts } = await prepareStakeOperation(
        this.rpc,
        this.accounts.stake,
        this.stakingProgram.programId,
        this.coder,
      );
      const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
      await this.stakingProgram.methods
        .unstake(proof, stakeAccountMeta, unstakeData)
        .accounts(this.accounts as Accounts)
        .remainingAccounts(remainingAccounts)
        .preInstructions([
          computeBudgetIx,
          await this.rewardsProgram.methods.close().accounts(this.accounts as Accounts).instruction(),
        ])
        .rpc();

      stakeData = await fetchCompressedStake(this.rpc, this.accounts.stake, this.coder);
      expect(stakeData.timeUnstake.toNumber()).to.not.equal(0);

      // Prepare restake with compressed account
      const restakePrep = await prepareStakeOperation(
        this.rpc,
        this.accounts.stake,
        this.stakingProgram.programId,
        this.coder,
      );
      await this.stakingProgram.methods
        .restake(restakePrep.proof, restakePrep.stakeAccountMeta, restakePrep.stakeData)
        .accounts({ ...this.accounts as Accounts, vault: this.vaults.staking })
        .remainingAccounts(restakePrep.remainingAccounts)
        .preInstructions([computeBudgetIx])
        .rpc();
    });

    it('can close other reward accounts', async function () {
      for (const node of this.users.otherNodes) {
        await this.rewardsProgram.methods
          .close()
          .accounts({
            ...this.accounts,
            reward: node.reward,
            authority: node.publicKey,
          } as Accounts)
          .signers([node.user])
          .rpc();
      }
    });
  });
}
