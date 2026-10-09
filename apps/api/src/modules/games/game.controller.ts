import { Body, Controller, Inject, Param, Post } from '@nestjs/common';
import { GameService } from './game.service';
import { SubmitGuessDto } from './submit-guess.dto';

@Controller('games')
export class GameController {
  constructor(@Inject(GameService) private readonly games: GameService) {}

  @Post()
  start() {
    return this.games.start();
  }

  @Post(':gameId/guesses')
  submit(@Param('gameId') gameId: string, @Body() body: SubmitGuessDto) {
    return this.games.submit(gameId, body.guess);
  }
}
