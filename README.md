# dstruct.io Open Source Game Project

This project is the open source version of http://dstruct.io.

Dstruct.io is based on Node.js, socket.io, phaser.io, and HTML5.

Other features include:

* Online multiplayer - players need only a modern browser.
* Continuous gameplay - join anytime!
* Client-side prediction for smooth gameplay over high-latency connections.
* Supports multiple servers, or 'rooms'.
* Each player only sees local updates.

...and much more!

## Local deployment instructions:

I have only tested this on Linux.

```
git clone git@github.com:stevepryde/dstructio.git
cd dstructio
npm install
./run.sh
```

This will deploy the game on localhost running on port 3000.

You can play the game by pointing your browser at http://localhost:3000, or
from other devices on your network by using your IP address instead of 'localhost'.

## Remote deployment instructions:

This software can be deployed remotely.

I highly recommend [DigitalOcean](https://m.do.co/c/29ce174827cb).
You can have your own server running for as little as $5/month.

The process for setting it up on DigitalOcean is as follows:

1. Create a new droplet using the one-click NodeJS + Ubuntu 16.04 template.
2. Follow the setup guide at:

   https://www.digitalocean.com/community/tutorials/initial-server-setup-with-ubuntu-16-04
3. Add swap space (this is only required for setup):

   https://www.digitalocean.com/community/tutorials/how-to-add-swap-space-on-ubuntu-16-04
4. Checkout the code:

   ```
   git clone git@github.com:stevepryde/dstructio.git
   ```
5. Install gulp:

   ```
   sudo npm install -g gulp
   ```
6. Install NPM modules:

   ```
   cd dstructio
   npm install
   ```
7. Build the project:

   ```
   ./deploy.sh
   ```
8. Edit the serverlist.json file and put in the IP address of your droplet instead of localhost.
9. Set up Nginx reverse proxy by following the guide at:

   https://www.digitalocean.com/community/tutorials/how-to-set-up-a-node-js-application-for-production-on-ubuntu-16-04
   * The two node scripts to run are:
     * bin/server/router.js
     * bin/server/server.js
   * The reverse proxy should be set up so that accessing your droplet's IP address at port 80 takes you to router.js.
   * Make sure that the serverlist.json points to where your server.js script is running.
10. Disable swap:

    ```
    sudo swapon --show
    sudo swapoff /swapfile
    ```
11. Test the game by pointing your browser at your droplet's IP address.

## LICENSE

Please see the LICENSE file.

### NodeJS Online Game Template

This project also uses code from the NodeJS Online Game Template,
available here:

https://github.com/huytd/node-online-game-template

Refer to doc/LICENSE-NOGT for the NodeJS Online Game Template license.

### Artwork

This project features artwork from opengameart.org and a huge thank you goes to the artists whose work has been used. In particular, SethByrd, SpriteAttack, and Cuzco.

The bomb sprites were created by SpriteAttack. These are licensed under a Creative Commons license ([CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)) and as such any modifications to these sprites may also be freely distributed in accordance with the license.

## CREDITS

If you do create anything interesting using this code, I would appreciate a reference to this project somewhere in your credits.

Thank you!
