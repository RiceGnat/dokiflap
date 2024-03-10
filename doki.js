const CHUNK_SIZE = 3;
const HEIGHT = 8;
const DEPTH = 6;
const BLOCK_SIZE = 16;
const SCROLL_SPEED = 40;
const PLAYER_MARGIN = 4;
const INITIAL_X = 2;
const INITIAL_Y = 3;
const GRAVITY = 1000;
const VERTICAL_SPEED = 150;
const SCREEN_HEIGHT = HEIGHT * BLOCK_SIZE;
const SCREEN_WIDTH = DEPTH * BLOCK_SIZE;
const PLAYER_SIZE = BLOCK_SIZE - PLAYER_MARGIN * 2;

// game engine framework
class GameEngine {
  #deltaTime;
  #lastFrameTime;
  #objects = []
  
  get objects() {
    return this.#objects;
  }
  
  run() {
    for(let i = 0, len = this.#objects.length; i < len; ++i) {
      if (typeof this.#objects[i].init === "function") {
        this.#objects[i].init();
      }
    }

    this.#draw();

    this.#lastFrameTime = window.performance.now();
    window.requestAnimationFrame(() => this.#update());
  }
  
  #update() {
    this.#deltaTime = window.performance.now() - this.#lastFrameTime;
    this.#lastFrameTime = window.performance.now();
    
    for(let i = 0, len = this.#objects.length; i < len; ++i) {
      if (typeof this.#objects[i].update === "function") {
        this.#objects[i].update(this.#deltaTime / 1000);
      }
    }

    this.#draw();

    window.requestAnimationFrame(() => this.#update());
  }

  #draw() {
    for(let i = 0, len = this.#objects.length; i < len; ++i) {
      if (typeof this.#objects[i].draw === "function") {
        this.#objects[i].draw();
      }
    }
  }
}

function randomInt(max) {
  return Math.floor(Math.random() * max);
}

// data objects
class MapSlice {
  floor = 0;
  path;
  obstacle;
  item;
}

class Map {
  constructor(height, depth, chunkSize, options) {
    this.height = height;
    this.depth = depth;
    this.chunkSize = chunkSize;
    options = {
      maxFloorRatio: 0.4,
      maxObstacleHeight: 3,
      minGap: 2,
      ...options
    };
    this.maxFloorHeight = Math.min(Math.floor(height * options.maxFloorRatio), height - 1);
    this.maxObstacleHeight = options.maxObstacleHeight;
    this.minGap = options.minGap;
    this.map = [];
  }
  
  get length() {
    return this.map.length;
  }

  init() {
    for (let i = 0; i < this.depth; i++) {
      this.map[i] = new MapSlice();
      this.map[i].path = [0, this.height - 1];
    }
  }

  next() {
    const offset = this.map.length;
    let lastPath = this.map[offset - 1].path;
    
    // select columns to place objects
    let obstaclePos = randomInt(this.chunkSize);
    let itemPos = randomInt(this.chunkSize);

    for (let i = offset; i < offset + this.chunkSize; i++) {
      // set initial column values
      this.map[i] = new MapSlice();
      this.map[i].floor = Math.min(lastPath[1] - this.minGap, randomInt(this.maxFloorHeight  + 1));
      this.map[i].path = [this.map[i].floor, this.height - 1];

      // attempt to generate an obstacle at the selected position
      if (i - offset == obstaclePos) {
        // split column into high/low sections
        const choices = [
          {
            span: [this.map[i].floor, lastPath[1] - this.minGap],
            path: [lastPath[1], this.height - 1]
          },
          {
            span: [Math.max(this.map[i].floor + this.minGap, lastPath[0] + this.minGap), this.height - 1],
            path: [this.map[i].floor, Math.max(this.map[i].floor, lastPath[0])]
          }
        ].filter(c => c.span[1] - c.span[0] >= 0);

        if (choices.length > 0) {
          // generate obstacle within selected section
          const { span, path } = choices[randomInt(choices.length)];
          const spanSize = span[1] - span[0] + 1;
          const obstacleStart = span[0] + randomInt(spanSize);
          this.map[i].obstacle = [obstacleStart, obstacleStart + Math.min(randomInt(span[1] - obstacleStart + 1), this.maxObstacleHeight - 1)];

          // adjust path around obstacle
          if (obstacleStart < path[0]) {
            path[0] = this.map[i].obstacle[1] + 1;
          }
          else {
            path[1] = obstacleStart - 1;
          }
          this.map[i].path = path;
        }
      }
      
      // attempt to generate an item at the selected position
      if (i - offset == itemPos) {
        this.map[i].item = {
          y: randomInt(this.map[i].path[1] - this.map[i].path[0] + 1) + this.map[i].path[0],
          value: 1
        }
      }
      
      lastPath = this.map[i].path;
    }
  }

  discard() {
    this.map.splice(0, this.chunkSize);
  }
  
  getSlice(i) {
    return this.map[i];
  }
  
  clear() {
    this.map = [];
  }
}

// game entities
class ScrollingBackground {
  #element;
  #offset = 0;
  #maxOffset;
  #parallax;
  paused;
  
  constructor(id, parallax, maxOffset) {
    this.#element = document.getElementById(id);
    this.#maxOffset = maxOffset;
    this.#parallax = parallax;
  }
  
  init() {
    this.#offset = 0;
    this.paused = false;
  }
  
  update(deltaTime) {
    if (!this.paused) {
      this.#offset += SCROLL_SPEED / this.#parallax * deltaTime;
      if (this.#offset >= this.#maxOffset) {
        this.#offset -= this.#maxOffset;
      }
    }
  }
  
  draw() {
    this.#element.style.setProperty("--offset", `-${Math.round(this.#offset)}px`)
  }
}

class Stage {
  #canvas;
  #ctx;
  #offCtx;
  #map;
  #offset = 0;
  #started = false;
  #redraw = true;
  #itemsCache = [];
  #sprites;
  #animationTimers;
  
  constructor(sprites) {
    this.#canvas = document.getElementById("canvas");
    this.#ctx = this.#canvas.getContext("2d");
    this.#canvas.width = (DEPTH + CHUNK_SIZE) * BLOCK_SIZE;
    this.#canvas.height = HEIGHT * BLOCK_SIZE;
    
    this.#canvas.offscreenCanvas = document.createElement("canvas");
    this.#canvas.offscreenCanvas.width = this.#canvas.width;
    this.#canvas.offscreenCanvas.height = this.#canvas.height;
    this.#offCtx = this.#canvas.offscreenCanvas.getContext("2d");
    
    this.#map = new Map(HEIGHT, DEPTH, CHUNK_SIZE);
    this.#sprites = sprites;
    this.#animationTimers = [
      new AnimationTimer(4, 1, 0),
      new AnimationTimer(5, 15, 1)
    ];
  }
  
  get offset() {
    return this.#offset;
  }

  init() {
    this.#map.init();
    this.#animationTimers[0].init();
    this.#animationTimers[1].init();
  }
  
  start() {
    this.#started = true;
    this.#map.next();
    this.#redraw = true;
  }

  update(deltaTime) {
    if (this.#started) {
      this.#offset += SCROLL_SPEED * deltaTime;
      this.#animationTimers[0].update(deltaTime);
      this.#animationTimers[1].update(deltaTime);
    }

    if (this.#offset > CHUNK_SIZE * BLOCK_SIZE) {
      this.#map.discard();
      this.#map.next();
      this.#offset -= CHUNK_SIZE * BLOCK_SIZE;
      this.#redraw = true;
    }
  }

  draw() {
    const ctx = this.#ctx;
    const offCtx = this.#offCtx;
    
    // redraw map when chunk cycles
    if (this.#redraw) {
      offCtx.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
      this.#itemsCache = [];
      
      for (let i = 0, len = this.#map.length; i < len; ++i) {
        const slice = this.#map.getSlice(i);
        const x = i * BLOCK_SIZE;
        let generateSpriteIndices = false;

        if (!slice.spriteIndices) {
          generateSpriteIndices = true;
          slice.spriteIndices = [];
        }
        
        if (this.#redraw) {
          for (let j = 0; j < HEIGHT; ++j) {
            // draw strut for sign
            if (slice.obstacle && j < slice.obstacle[0] && (j >= slice.floor || j > 1)) {
              const sprite = this.#sprites.obstacles[0][0];
              offCtx.drawImage(sprite, x, (HEIGHT - j - 1) * BLOCK_SIZE, sprite.width, sprite.height);
            }
            
            // draw buildings
            if (j < slice.floor) {
              // cache sprite rng
              if (generateSpriteIndices) {
                slice.spriteIndices[j] = randomInt((j == 0 ? 4 : 3));
              }
              
              const sprite = this.#sprites.floor[j][slice.spriteIndices[j]];
              offCtx.drawImage(sprite, (j == 0 ? x - 1 : x), (HEIGHT - j - 1) * BLOCK_SIZE, sprite.width, sprite.height);
            }
            
            // draw signs
            if (slice.obstacle && j == slice.obstacle[1]) {
              const size = slice.obstacle[1] - slice.obstacle[0] + 1;
              const sprite = this.#sprites.obstacles[size][0];
              offCtx.drawImage(sprite, x, (HEIGHT - j - 1) * BLOCK_SIZE, sprite.width, sprite.height);
            }
          }
          
        }

        if (slice.item) {
          this.#itemsCache.push({ x: i, ...slice.item });
        }
      }

      this.#redraw = false;
    }
    
    // copy map to visible canvas and draw items
    const offset = -Math.round(this.#offset);
    ctx.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
    ctx.drawImage(this.#canvas.offscreenCanvas, offset, 0);

    for (let i = 0, len = this.#itemsCache.length; i < len; ++i) {
      const f = this.#animationTimers[0].f;
      const y = (HEIGHT - this.#itemsCache[i].y - 1) * BLOCK_SIZE + (f % 2 == 0 ? 0 : f == 1 ? 1 : -1);
      ctx.drawImage(this.#sprites.items[0][0], this.#itemsCache[i].x * BLOCK_SIZE + offset, y, BLOCK_SIZE, BLOCK_SIZE);
      ctx.drawImage(this.#sprites.items[1][this.#animationTimers[1].f], this.#itemsCache[i].x * BLOCK_SIZE + offset, y, BLOCK_SIZE, BLOCK_SIZE);
    }
  }
  
  stop() {
    this.#started = false;
  }
  
  reset() {
    this.#map.clear();
    this.#map.init();
    this.#offset = 0;
    this.#redraw = true;
  }
  
  checkSpace(x, y) {
    const slice = this.#map.getSlice(x);
    return {
      isCollision: y < slice.floor || (slice.obstacle && y >= slice.obstacle[0] && y <= slice.obstacle[1]),
      item: (slice.item && y == slice.item.y) ? slice.item : null
    };
  }
  
  clearItem(x) {
    const slice = this.#map.getSlice(x);
    this.#itemsCache.splice(this.#itemsCache.findIndex(item => item.x == x), 1);
    slice.item = null;
  }
}

class Player {
  #canvas;
  #ctx;
  #stage;
  #position;
  #velocity;
  #score;
  #active = false;
  #failed = false;
  #sprites;
  #animationTimer;

  constructor(stage, sprites) {
    this.#canvas = document.getElementById("player");
    this.#ctx = this.#canvas.getContext("2d");
    this.#canvas.width = SCREEN_WIDTH;
    this.#canvas.height = SCREEN_HEIGHT;
    this.#stage = stage;
    this.#sprites = sprites;
    this.#animationTimer = new AnimationTimer(4, 7.5, 0);
  }
  
  get position() {
    return this.#position;
  }
  
  get score() {
    return this.#score;
  }

  init() {
    this.#position = {
      x: (INITIAL_X) * BLOCK_SIZE,
      y: (HEIGHT - INITIAL_Y - 1) * BLOCK_SIZE
    };
    this.#velocity = { x: 0, y: 0 };

    this.#score = 0;
    if (typeof this.onScore === "function") {
      this.onScore(this.#score);
    }

    this.#animationTimer.init();
  }

  input(e) {
    if (e.type === "keydown" && e.key === " " || e.type === "mousedown" || e.type === "touchstart") {
      if (!this.#failed) {
        if (!this.#active) {
          this.#active = true;
          this.#stage.start();
        }
        this.#velocity.y = VERTICAL_SPEED;
        this.#animationTimer.f = 3;
        this.#animationTimer.t = 0;
      }
    }
  }

  update(deltaTime) {
    if (this.#active) {
      this.#velocity.y = Math.max(this.#velocity.y - GRAVITY * deltaTime, -VERTICAL_SPEED);

      this.#position.x += this.#velocity.x;
      this.#position.y = Math.max(this.#position.y - this.#velocity.y * deltaTime, -PLAYER_MARGIN - PLAYER_SIZE / 2);

      const c = this.#checkCollisions();
      if (c.isCollision) {
        this.fail();
      }
      else {
        // handle collected items
        c.items.forEach(item => {
          this.#stage.clearItem(item.x);
          this.#score += item.value;
        });
        if (typeof this.onScore === "function") {
          this.onScore(this.#score);
        }
      }
    }
    else if (this.#failed && this.#position.y < SCREEN_HEIGHT) {
      this.#position.y += VERTICAL_SPEED * deltaTime;
    }
    
    if (!this.#failed) {
      this.#animationTimer.update(deltaTime);
    }
        
    // check for falling off bottom edge
    if (this.#position.y >= SCREEN_HEIGHT) {
      if (!this.#failed) {
        this.fail();
      }
    }
  }

  draw() {
    const ctx = this.#ctx;
    const x = Math.round(this.#position.x);
    const y = Math.round(this.#position.y);
    ctx.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    ctx.drawImage(this.#sprites.player[this.#animationTimer.f], x, y, BLOCK_SIZE, BLOCK_SIZE);
  }

  fail() {
    this.#active = false;
    this.#stage.stop();
    this.#failed = true;
    this.#animationTimer.f = 0;
    if (typeof this.onFail === "function") {
      this.onFail();
    }
  }

  reset() {
    this.#stage.reset();
    this.init();
    this.#failed = false;
  }
  
  #checkCollisions() {
    // get pixel bounds of player
    const bounds = {
      x: {
        min: this.#position.x + PLAYER_MARGIN + this.#stage.offset,
        max: this.#position.x + BLOCK_SIZE - PLAYER_MARGIN + this.#stage.offset
      },
      y: {  
        min: this.#position.y + PLAYER_MARGIN,
        max: this.#position.y + BLOCK_SIZE - PLAYER_MARGIN
      },
    };
    
    // convert to map tile indices
    bounds.x.min = Math.floor(bounds.x.min / BLOCK_SIZE);
    bounds.x.max = Math.floor(bounds.x.max / BLOCK_SIZE);
    bounds.y.min = HEIGHT - Math.floor(bounds.y.min / BLOCK_SIZE) - 1;
    bounds.y.max = HEIGHT - Math.floor(bounds.y.max / BLOCK_SIZE) - 1;
    
    // condense duplicate values when player within column/row
    const x = [bounds.x.min];
    if (bounds.x.max != bounds.x.min) {
      x[1] = bounds.x.max;
    }
    const y = [];
    if (bounds.y.max >= 0 && bounds.y.max < HEIGHT) {
      y.push(bounds.y.max);
    }
    if (bounds.y.min >= 0 && bounds.y.min < HEIGHT && bounds.y.min != bounds.y.max) {
      y.push(bounds.y.min);
    }
    
    // check overlapped spaces
    const items = [];
    let isCollision = false;
    for (let i = 0; i < x.length; ++i) {
      for (let j = 0; j < y.length; ++j) {
        const space = this.#stage.checkSpace(x[i], y[j]);
        isCollision |= space.isCollision;
        if (space.item) {
          // TODO refine item bounding box
          items.push({ x: x[i], ...space.item });
        }
      }
    }
    
    return { isCollision, items };
  }
}

class ImageLoader {
  #src;
  #image;
  
  constructor(src) {
    this.#src = src;
    this.#image = new Image();
  }
  
  load() {
    return new Promise((resolve, reject) => {
      this.#image.onload = () => resolve(this.#image);
      this.#image.src = this.#src;
    });
  }
}

class AnimationTimer {
  #frames;
  #frameInterval;
  #repeatDelay;
  
  constructor(frames, frameRate, repeatDelay) {
    this.#frames = frames;
    this.#frameInterval = 1 / frameRate;
    this.#repeatDelay = repeatDelay;
  }
  
  init() {
    this.f = 0;
    this.t = 0;
  }
  
  update(deltaTime) {
    this.t += deltaTime;
    
    if (this.f == this.#frames - 1 && this.t >= this.#repeatDelay + this.#frameInterval) {
      this.t -= this.#repeatDelay + this.#frameInterval;
      this.f = 0;
    }
    else if (this.f < this.#frames - 1 && this.t >= this.#frameInterval) {
      this.t -= this.#frameInterval;
      this.f++;
    }
  }
}

// load assets
async function loadSprites() {
  const sprites = {};
  let image = await new ImageLoader("assets/fg_0.png").load();
  
  // player
  sprites.player = [];
  for (let i = 0; i < 4; ++i) {
    sprites.player.push(await createImageBitmap(image, i * BLOCK_SIZE + 1, 0, BLOCK_SIZE, BLOCK_SIZE));
  }
  
  // buildings
  sprites.floor = [[],[],[]];
  for (let i = 0; i < 4; ++i) {
    sprites.floor[0].push(await createImageBitmap(image, i * BLOCK_SIZE, 64, BLOCK_SIZE + 2, BLOCK_SIZE));
  }
  
  for (let i = 0; i < 3; ++i) {
    sprites.floor[1].push(await createImageBitmap(image, i * BLOCK_SIZE + 1, 48, BLOCK_SIZE, BLOCK_SIZE));
    sprites.floor[2].push(await createImageBitmap(image, i * BLOCK_SIZE + 1, 32, BLOCK_SIZE, BLOCK_SIZE));
  }
  
  sprites.obstacles = [[],[],[],[]];
  
  // strut
  sprites.obstacles[0].push(await createImageBitmap(image, 3 * BLOCK_SIZE + 1, 48, BLOCK_SIZE, BLOCK_SIZE));
  
  // signs
  sprites.obstacles[1].push(await createImageBitmap(image, 3 * BLOCK_SIZE + 1, 32, BLOCK_SIZE, BLOCK_SIZE));
  sprites.obstacles[2].push(await createImageBitmap(image, 4 * BLOCK_SIZE + 1, 32, BLOCK_SIZE, BLOCK_SIZE * 2));
  sprites.obstacles[3].push(await createImageBitmap(image, 5 * BLOCK_SIZE + 1, 32, BLOCK_SIZE, BLOCK_SIZE * 3));
  
  // jewel
  sprites.items = [[], []];
  sprites.items[0].push(await createImageBitmap(image, 1, 16, BLOCK_SIZE, BLOCK_SIZE));
  
  for (let i = 1; i <= 5; ++i) {
    sprites.items[1].push(await createImageBitmap(image, i * BLOCK_SIZE + 1, 16, BLOCK_SIZE, BLOCK_SIZE));
  }
  
  return sprites;
}

loadSprites().then((sprites) => {
  // set up objects
  const engine = new GameEngine();
  const bg1 = new ScrollingBackground("bg_1", 4, 288);
  engine.objects.push(bg1);
  const stage = new Stage(sprites);
  engine.objects.push(stage);
  const player = new Player(stage, sprites);
  engine.objects.push(player);

  const ui = document.getElementById("ui");
  const gameover = document.getElementById("gameover");
  const restartBtn = document.getElementById("restartBtn");

  player.onScore = score => {
    ui.innerHTML = `Score: ${score}`;
  };

  player.onFail = () => {
    bg1.paused = true;
    gameover.className = "";
    ui.className = "absolute";
  };

  restartBtn.onclick = () => {
    player.reset();
    bg1.paused = false;
    gameover.className = "hidden";
    ui.className = "";
  };

  // bind input
  document.addEventListener("keydown", e => {
    if (!e.repeat) player.input(e);
  });
  document.addEventListener("mousedown", e => player.input(e));
  document.addEventListener("touchstart", e => player.input(e));

  const footer = document.getElementById("footer");
  footer.addEventListener("mousedown", e => e.stopPropagation());

  // debug stuff
  /*
  const frameTimes = [];
  engine.objects.push({
    update: deltaTime => {
      frameTimes.push(deltaTime);
      if (frameTimes.length > 60) {
        frameTimes.shift();
      }
    },
    draw: _ => {
      footer.innerHTML = `FPS: ${Math.floor(1/(frameTimes.reduce((a, b) => a + b, 0)/frameTimes.length))}`;
    }
  });
  */

  // run game
  engine.run();
});