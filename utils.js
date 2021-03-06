import * as anchor from '@project-serum/anchor';

export const CIVIC = new anchor.web3.PublicKey(
    'gatem74V238djXdzWnJf94Wo1DcnuGkfijbf3AuBhfs',
);

export const getNetworkExpire = async (gatekeeperNetwork) => {
    return await anchor.web3.PublicKey.findProgramAddress(
      [gatekeeperNetwork.toBuffer(), Buffer.from('expire')],
      CIVIC,
    );
};