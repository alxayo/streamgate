import bcrypt from 'bcrypt';
import readline from 'node:readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question('Enter admin password: ', async (password: string) => {
  if (!password || password.length < 8) {
    console.error('Password must be at least 8 characters');
    rl.close();
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  console.log(`\nADMIN_PASSWORD_HASH=${hash}`);
  console.log('\nCopy the line above into your .env file.');
  rl.close();
});
