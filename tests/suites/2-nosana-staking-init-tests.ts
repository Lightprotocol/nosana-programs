import * as anchor from '@coral-xyz/anchor';
import { web3 } from '@coral-xyz/anchor';
import { expect } from 'chai';
import { calculateXnos, getTokenBalance, prepareStakeCreate, fetchCompressedStake } from '../utils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Accounts = any;

export default function suite() {
  afterEach(async function () {
    expect(await getTokenBalance(this.provider, this.accounts.user)).to.equal(this.balances.user);
  });

  describe('init()', async function () {
    it('can initialize', async function () {
      this.accounts.vault = this.vaults.staking;
      await this.stakingProgram.methods.init().accounts(this.accounts as Accounts).rpc();
    });
  });

  describe('stake()', async function () {
    it('can stake minimum', async function () {
      const { proof, addressTreeInfo, outputStateTreeIndex, remainingAccounts } = await prepareStakeCreate(
        this.rpc,
        this.accounts.stake,
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
        .accounts(this.accounts as Accounts)
        .remainingAccounts(remainingAccounts)
        .preInstructions([computeBudgetIx])
        .rpc();
      this.balances.user -= this.constants.minimumNodeStake;
      this.balances.vaultStaking += this.constants.minimumNodeStake;

      // test stake
      const stake = await fetchCompressedStake(this.rpc, this.accounts.stake, this.coder);
      expect(stake.amount.toNumber()).to.equal(this.constants.minimumNodeStake, 'amount');
      expect(stake.vault.toString()).to.equal(this.accounts.vault.toString(), 'vault');
      expect(stake.authority.toString()).to.equal(this.accounts.authority.toString(), 'authority');
      expect(stake.duration.toNumber()).to.equal(this.constants.stakeDurationMin, 'duration');
      expect(stake.xnos.toNumber()).to.equal(
        calculateXnos(this.constants.stakeDurationMin, this.constants.minimumNodeStake),
        'xnos',
      );
    });

    it('can stake for other nodes', async function () {
      for (const node of [this.users.node1, this.users.node2, ...this.users.otherNodes]) {
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
            ...this.accounts as Accounts,
            user: node.ata,
            authority: node.publicKey,
            stake: node.stake,
            vault: node.vault,
          })
          .remainingAccounts(remainingAccounts)
          .preInstructions([computeBudgetIx])
          .signers([node.user])
          .rpc();
        this.balances.vaultStaking += this.constants.stakeAmount * 2;
        node.balance -= this.constants.stakeAmount * 2;
        expect(await getTokenBalance(this.provider, node.ata)).to.equal(node.balance);
      }
    });
  });
}
