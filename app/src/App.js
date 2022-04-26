import React, { useEffect, useState } from 'react';
import './App.css';
import CandyMachine from './CandyMachine';
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore, collection, doc, addDoc, getDocs, updateDoc, setDoc } from 'firebase/firestore';

// Constants
const WEBSITE_LINK = "https://alexochs.de";

const App = () => {
  // State
  const [walletAddress, setWalletAddress] = useState(null);
  const [firebaseApp, setFirebaseApp] = useState(null);
  const [metadatas, setMetadatas] = useState([]);
  const [mintsLoading, setMintsLoading] = useState(true);
  //let heartId = 0;
  //const [heartId, setHeartId] = useState(0);
  //const [heart, setHeart] = useState("💜💙🧡💛💚")

  useEffect(() => {
    const firebaseConfig = {
      apiKey: "AIzaSyDS4ESrKdQzPWHlPfYp14Tw_nwQnFpuo1k",
      authDomain: "collection-ac461.firebaseapp.com",
      projectId: "collection-ac461",
      storageBucket: "collection-ac461.appspot.com",
      messagingSenderId: "951419856303",
      appId: "1:951419856303:web:b0eb1efea9efc0c582bb5a",
      measurementId: "G-Q3D6R1KW69"
    };
    
    const app = initializeApp(firebaseConfig);
    const analytics = getAnalytics(app);
    setFirebaseApp(app);

    getMetadatas(app).then(() => setMintsLoading(false));
  }, []);

  // Actions
  const checkIfWalletIsConnected = async () => {
    try {
      const { solana } = window;

      if (solana) {
        if (solana.isPhantom) {
          console.log('Phantom wallet found!');
          const response = await solana.connect({ onlyIfTrusted: true });
          console.log(
            'Connected with Public Key:',
            response.publicKey.toString()
          );

          /*
           * Set the user's publicKey in state to be used later!
           */
          setWalletAddress(response.publicKey.toString());
        }
      } else {
        alert('Solana object not found! Get a Phantom Wallet 👻');
      }
    } catch (error) {
      console.error(error);
    }
  };

  const connectWallet = async () => {
    const { solana } = window;
  
    if (solana) {
      const response = await solana.connect();
      console.log('Connected with Public Key:', response.publicKey.toString());
      setWalletAddress(response.publicKey.toString());
    }
  };
  const renderNotConnectedContainer = () => (
    <div>
      <p className="sub-text"><b>Mint your NFT now!</b></p>
      <button
        className="cta-button gradient-button"
        onClick={connectWallet}
      >
        Connect to Solana
      </button>
    </div>
  );

  useEffect(() => {
    const onLoad = async () => {
      await checkIfWalletIsConnected();
    };
    window.addEventListener('load', onLoad);
    return () => window.removeEventListener('load', onLoad);
  }, []);

  const getMetadatas = async (db) => {
    console.log("Fetching metadatas from database...");

    let metadatas = [];
    const querySnapshot = await getDocs(collection(getFirestore(db), "metadatas"));
    querySnapshot.forEach((doc) => {
      metadatas.push(doc.data());
    });

    console.log("✅ Fetched metadatas");
    console.log(metadatas);

    setMetadatas(metadatas);
    return metadatas;
  }

  const renderMint = (metadata) => {
      return (
        <div className="nft-container">
          <img className="nft-image" src={metadata.off_chain_data.image}></img>
          <div className="nft-info">
            <p className="nft-name">{metadata.off_chain_data.name}</p>
            <p className="nft-description">{metadata.off_chain_data.description}</p>
            <a className="nft-link" href={metadata.explorer_url} target="_blank">View on Solana Explorer</a>
          </div>
        </div>
      );
    };

  const renderMintedItems = () => {
    if (mintsLoading) {
      return <p>Loading...</p>
    }
    else if (metadatas.length === 0) {
      return <p className="subsub-text">Nothing's been minted yet, <b>be the first one! 🏁</b></p>
    }
    else {
      return (
        <div className="minted-list-container">
          {metadatas.map((metadata) => (
            <div className="mint-list-item">
              {renderMint(metadata)}
            </div>
          ))}
        </div>
      );
    }
  }

  const renderMintListasdf = () => {
    <div className="othermints-container">
      <p className="sub-text">Latest Mints:</p>
      {renderMintedItems()}
    </div>
  }

  if (!walletAddress) {
    return (
      <div className="App">
        <div className="container">
          <div className="header-container">
            <p className="header gradient-text">✨ THE 353 COLLECTION ✨</p>
          </div>
          <div className="body-container">
            {!walletAddress && renderNotConnectedContainer()}
            {walletAddress && <CandyMachine walletAddress={window.solana} firebaseApp={firebaseApp}/>}
          </div>
          <div className="othermints-container">
            <p className="sub-text">Latest Mints:</p>
            {renderMintedItems()}
          </div>
          <div className="footer-container">
            <a
              className="footer-text"
              href={WEBSITE_LINK}
              target="_blank"
              rel="noreferrer"
            >{`Made with 💜 by Alex Ochs`}</a>
          </div>
        </div>
      </div>
    );
  }
  else {
    return (
      <div className="App">
        <div className="container">
          <div className="header-container">
            <p className="header gradient-text">✨ THE 353 COLLECTION ✨</p>
          </div>
          <div className="body-container">
            {!walletAddress && renderNotConnectedContainer()}
            {walletAddress && <CandyMachine walletAddress={window.solana} firebaseApp={firebaseApp}/>}
          </div>
          <div className="footer-container">
            <a
              className="footer-text"
              href={WEBSITE_LINK}
              target="_blank"
              rel="noreferrer"
            >{`Made with 💜 by Alex Ochs`}</a>
          </div>
        </div>
      </div>
    );
  }
};

export default App;