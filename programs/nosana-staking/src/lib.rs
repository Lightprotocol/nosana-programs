mod errors;
mod instructions;
mod macros;
mod security;
mod state;

use anchor_lang::prelude::*;
pub use errors::*; // expose errors for cpi
use instructions::*;
use light_sdk::{
    cpi::{v2::CpiAccounts, CpiSigner},
    derive_light_cpi_signer,
};
use nosana_common::*;
pub use state::*; // expose stake for cpi

declare_id!(id::STAKING_PROGRAM);

/// CPI signer for Light Protocol compressed account operations.
/// Derived from the staking program ID: nosScmHY2uR24Zh751PmGj9ww9QRNHewh9H59AfrTJE
pub const LIGHT_CPI_SIGNER: CpiSigner =
    derive_light_cpi_signer!("nosScmHY2uR24Zh751PmGj9ww9QRNHewh9H59AfrTJE");

/// Allowed address tree for compressed stake accounts.
/// This ensures all stake accounts are created in the same address tree
/// to guarantee compressed PDA uniqueness.
#[constant]
pub const ALLOWED_ADDRESS_TREE: Pubkey =
    pubkey!("amt2kaJA14v3urZbZvnc5v2np8jqvc4Z8zDep5wbtzx");

/// Verify that the address tree used for compressed account creation is the allowed one.
/// This check ensures compressed PDA uniqueness by requiring all stake accounts
/// to be created in the same address tree.
pub fn verify_address_tree(
    light_cpi_accounts: &CpiAccounts,
    address_tree_info: &light_sdk::instruction::PackedAddressTreeInfo,
) -> Result<Pubkey> {
    let address_tree = address_tree_info
        .get_tree_pubkey(light_cpi_accounts)
        .map_err(|_| NosanaError::InvalidAccount)?;

    require!(
        address_tree == ALLOWED_ADDRESS_TREE,
        NosanaStakingError::InvalidAddressTree
    );

    Ok(address_tree)
}

#[program]
pub mod nosana_staking {
    use super::*;

    /// Initialize the [SettingsAccount](#settings-account).
    pub fn init(ctx: Context<Init>) -> Result<()> {
        ctx.accounts.handler()
    }

    /// Create a compressed [StakeAccount](#stake-account) and [VaultAccount](#vault-account).
    /// Stake `amount` of [NOS](/tokens/token) tokens for `duration` of seconds.
    /// The stake account is stored as a Light Protocol compressed account.
    pub fn stake<'info>(
        ctx: Context<'_, '_, '_, 'info, Stake<'info>>,
        amount: u64,
        duration: u128,
        proof: light_sdk::instruction::ValidityProof,
        address_tree_info: light_sdk::instruction::PackedAddressTreeInfo,
        output_state_tree_index: u8,
    ) -> Result<()> {
        let vault_bump = ctx.bumps.vault;
        Stake::handler(ctx, amount, duration, vault_bump, proof, address_tree_info, output_state_tree_index)
    }

    /// Start the unstake duration for a compressed stake account.
    pub fn unstake<'info>(
        ctx: Context<'_, '_, '_, 'info, Unstake<'info>>,
        proof: light_sdk::instruction::ValidityProof,
        stake_account_meta: light_sdk::instruction::account_meta::CompressedAccountMeta,
        stake_data: CompressedStakeAccount,
    ) -> Result<()> {
        Unstake::handler(ctx, proof, stake_account_meta, stake_data)
    }

    /// Make a stake active again and reset the unstake time.
    pub fn restake<'info>(
        ctx: Context<'_, '_, '_, 'info, Restake<'info>>,
        proof: light_sdk::instruction::ValidityProof,
        stake_account_meta: light_sdk::instruction::account_meta::CompressedAccountMeta,
        stake_data: CompressedStakeAccount,
    ) -> Result<()> {
        Restake::handler(ctx, proof, stake_account_meta, stake_data)
    }

    /// Top-up `amount` of [NOS](/tokens/token) of a compressed stake account.
    pub fn topup<'info>(
        ctx: Context<'_, '_, '_, 'info, Topup<'info>>,
        amount: u64,
        proof: light_sdk::instruction::ValidityProof,
        stake_account_meta: light_sdk::instruction::account_meta::CompressedAccountMeta,
        stake_data: CompressedStakeAccount,
    ) -> Result<()> {
        Topup::handler(ctx, amount, proof, stake_account_meta, stake_data)
    }

    /// Extend the `duration` of a compressed stake account.
    pub fn extend<'info>(
        ctx: Context<'_, '_, '_, 'info, Extend<'info>>,
        duration: u64,
        proof: light_sdk::instruction::ValidityProof,
        stake_account_meta: light_sdk::instruction::account_meta::CompressedAccountMeta,
        stake_data: CompressedStakeAccount,
    ) -> Result<()> {
        Extend::handler(ctx, duration, proof, stake_account_meta, stake_data)
    }

    /// Close a compressed stake account and its vault token account.
    pub fn close<'info>(
        ctx: Context<'_, '_, '_, 'info, Close<'info>>,
        proof: light_sdk::instruction::ValidityProof,
        stake_account_meta: light_sdk::instruction::account_meta::CompressedAccountMeta,
        stake_data: CompressedStakeAccount,
    ) -> Result<()> {
        Close::handler(ctx, proof, stake_account_meta, stake_data)
    }

    /// Withdraw [NOS](/tokens/token) that is released after an [unstake](#unstake).
    /// The stake data is verified via read-only proof but not mutated.
    pub fn withdraw<'info>(
        ctx: Context<'_, '_, '_, 'info, Withdraw<'info>>,
        proof: light_sdk::instruction::ValidityProof,
        stake_account_meta: light_sdk::instruction::account_meta::CompressedAccountMetaReadOnly,
        stake_data: CompressedStakeAccount,
    ) -> Result<()> {
        Withdraw::handler(ctx, proof, stake_account_meta, stake_data)
    }

    /// Reduce a compressed stake account's [NOS](/tokens/token) tokens.
    /// Slashing is a feature used by the Nosana Protocol to punish bad actors.
    pub fn slash<'info>(
        ctx: Context<'_, '_, '_, 'info, Slash<'info>>,
        amount: u64,
        proof: light_sdk::instruction::ValidityProof,
        stake_account_meta: light_sdk::instruction::account_meta::CompressedAccountMeta,
        stake_data: CompressedStakeAccount,
    ) -> Result<()> {
        Slash::handler(ctx, amount, proof, stake_account_meta, stake_data)
    }

    /// Update the Slashing Authority and Token Account.
    pub fn update_settings(ctx: Context<UpdateSettings>) -> Result<()> {
        ctx.accounts.handler()
    }
}
